"""Local SQLite storage for accounts, preferences, and chat history.

Everything lives on the user's own machine. There is no server to rent and no
shared database, so a downloaded copy of Lune works fully offline apart from
the calls it makes to the user's own AI provider.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL DEFAULT '',
    pw_hash      BLOB NOT NULL,
    pw_salt      BLOB NOT NULL,
    enc_salt     BLOB NOT NULL,
    key_blob     BLOB,
    key_provider TEXT NOT NULL DEFAULT '',
    key_hint     TEXT NOT NULL DEFAULT '',
    prefs        TEXT NOT NULL DEFAULT '{}',
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS threads (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT 'New chat',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id  TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    files      TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at REAL NOT NULL
);

-- One row per user per day, plus a row with user_id 0 for the whole instance.
CREATE TABLE IF NOT EXISTS usage (
    user_id INTEGER NOT NULL,
    day     TEXT NOT NULL,
    count   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_threads_user ON threads(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
"""

GLOBAL_USAGE_ROW = 0


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def data_dir() -> Path:
    """Where Lune keeps its database, following each platform's convention."""
    override = os.environ.get("LUNE_DATA_DIR", "").strip()
    if override:
        path = Path(override).expanduser()
    elif sys.platform == "darwin":
        path = Path.home() / "Library" / "Application Support" / "Lune"
    elif os.name == "nt":
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        path = Path(base) / "Lune"
    else:
        base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
        path = Path(base) / "Lune"

    path.mkdir(parents=True, exist_ok=True)
    return path


def db_path() -> Path:
    return data_dir() / "lune.db"


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(str(db_path()))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    path = db_path()
    fresh = not path.exists()
    with connect() as conn:
        conn.executescript(SCHEMA)
    if fresh:
        # The database can hold API keys, so keep it readable only by its owner.
        try:
            path.chmod(0o600)
        except OSError:
            pass


# accounts


def create_user(
    username: str,
    display_name: str,
    pw_hash: bytes,
    pw_salt: bytes,
    enc_salt: bytes,
    prefs: Dict[str, Any],
) -> int:
    with connect() as conn:
        cursor = conn.execute(
            """INSERT INTO users
               (username, display_name, pw_hash, pw_salt, enc_salt, prefs, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                username,
                display_name,
                pw_hash,
                pw_salt,
                enc_salt,
                json.dumps(prefs),
                _now(),
            ),
        )
        return int(cursor.lastrowid)


def find_user(username: str) -> Optional[sqlite3.Row]:
    with connect() as conn:
        cursor = conn.execute("SELECT * FROM users WHERE username = ?", (username,))
        return cursor.fetchone()


def get_user(user_id: int) -> Optional[sqlite3.Row]:
    with connect() as conn:
        cursor = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        return cursor.fetchone()


def user_count() -> int:
    with connect() as conn:
        return int(conn.execute("SELECT COUNT(*) FROM users").fetchone()[0])


def set_password(user_id: int, pw_hash: bytes, pw_salt: bytes) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?",
            (pw_hash, pw_salt, user_id),
        )


def set_api_key(user_id: int, blob: Optional[bytes], provider: str, hint: str) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE users SET key_blob = ?, key_provider = ?, key_hint = ? WHERE id = ?",
            (blob, provider, hint, user_id),
        )


def set_prefs(user_id: int, prefs: Dict[str, Any]) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE users SET prefs = ? WHERE id = ?", (json.dumps(prefs), user_id)
        )


def get_prefs(user_id: int) -> Dict[str, Any]:
    row = get_user(user_id)
    if not row:
        return {}
    try:
        return json.loads(row["prefs"] or "{}")
    except json.JSONDecodeError:
        return {}


def delete_user(user_id: int) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))


# chat history


def list_threads(user_id: int, limit: int = 200) -> List[Dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            """SELECT t.id, t.title, t.updated_at,
                      (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) AS count
               FROM threads t
               WHERE t.user_id = ?
               ORDER BY t.updated_at DESC
               LIMIT ?""",
            (user_id, limit),
        ).fetchall()
    return [
        {
            "id": row["id"],
            "title": row["title"],
            "updatedAt": row["updated_at"],
            "count": row["count"],
        }
        for row in rows
    ]


def create_thread(user_id: int, title: str = "New chat") -> str:
    thread_id = uuid.uuid4().hex
    stamp = _now()
    with connect() as conn:
        conn.execute(
            "INSERT INTO threads (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (thread_id, user_id, title, stamp, stamp),
        )
    return thread_id


def owns_thread(user_id: int, thread_id: str) -> bool:
    with connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM threads WHERE id = ? AND user_id = ?", (thread_id, user_id)
        ).fetchone()
    return row is not None


def rename_thread(user_id: int, thread_id: str, title: str) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE threads SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?",
            (title, _now(), thread_id, user_id),
        )


def delete_thread(user_id: int, thread_id: str) -> None:
    with connect() as conn:
        conn.execute(
            "DELETE FROM threads WHERE id = ? AND user_id = ?", (thread_id, user_id)
        )


def get_messages(user_id: int, thread_id: str) -> List[Dict[str, Any]]:
    if not owns_thread(user_id, thread_id):
        return []
    with connect() as conn:
        rows = conn.execute(
            "SELECT role, content, files FROM messages WHERE thread_id = ? ORDER BY id",
            (thread_id,),
        ).fetchall()

    messages: List[Dict[str, Any]] = []
    for row in rows:
        try:
            files = json.loads(row["files"] or "[]")
        except json.JSONDecodeError:
            files = []
        messages.append({"role": row["role"], "content": row["content"], "files": files})
    return messages


def add_message(
    user_id: int,
    thread_id: str,
    role: str,
    content: str,
    files: Optional[List[Dict[str, Any]]] = None,
) -> None:
    if not owns_thread(user_id, thread_id):
        return
    with connect() as conn:
        conn.execute(
            "INSERT INTO messages (thread_id, role, content, files, created_at) VALUES (?, ?, ?, ?, ?)",
            (thread_id, role, content, json.dumps(files or []), _now()),
        )
        conn.execute(
            "UPDATE threads SET updated_at = ? WHERE id = ?", (_now(), thread_id)
        )


# sessions
#
# Sessions are persisted so a restart or a second worker process does not sign
# everyone out. Only a hash of the token is stored, so reading the database does
# not hand out valid sessions.


def save_session(token_hash: str, user_id: int, created: float) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)",
            (token_hash, user_id, created),
        )


def load_session(token_hash: str) -> Optional[Dict[str, Any]]:
    with connect() as conn:
        row = conn.execute(
            "SELECT user_id, created_at FROM sessions WHERE token_hash = ?", (token_hash,)
        ).fetchone()
    if not row:
        return None
    return {"user_id": int(row["user_id"]), "created": float(row["created_at"])}


def drop_session(token_hash: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))


def drop_user_sessions(user_id: int) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))


def purge_expired_sessions(cutoff: float) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM sessions WHERE created_at < ?", (cutoff,))


# usage accounting


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def record_usage(user_id: int) -> None:
    """Count one billed request against the user and the instance total."""
    day = _today()
    with connect() as conn:
        for owner in (user_id, GLOBAL_USAGE_ROW):
            conn.execute(
                """INSERT INTO usage (user_id, day, count) VALUES (?, ?, 1)
                   ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1""",
                (owner, day),
            )


def usage_today(user_id: int) -> int:
    with connect() as conn:
        row = conn.execute(
            "SELECT count FROM usage WHERE user_id = ? AND day = ?", (user_id, _today())
        ).fetchone()
    return int(row["count"]) if row else 0


def global_usage_today() -> int:
    return usage_today(GLOBAL_USAGE_ROW)
