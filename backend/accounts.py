"""Local accounts: password hashing, sessions, and per-user API key encryption.

The user's API key is encrypted with a key derived from their password, so it is
unreadable in the database without that password. The derived key only ever
lives in memory for the duration of a signed-in session, which is why signing
out (or quitting the app) requires signing in again before Lune can use the key.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
import threading
import time
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

from cryptography.fernet import Fernet, InvalidToken

PBKDF2_ROUNDS = 240_000
SESSION_TTL_SECONDS = 30 * 24 * 3600

USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{3,32}$")
MIN_PASSWORD = 8


class AuthError(RuntimeError):
    """Raised for any sign-up or sign-in problem the user can act on."""


# passwords


def hash_password(password: str, salt: Optional[bytes] = None) -> Tuple[bytes, bytes]:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)
    return digest, salt


def verify_password(password: str, expected: bytes, salt: bytes) -> bool:
    digest, _ = hash_password(password, salt)
    return hmac.compare_digest(digest, expected)


def validate_username(username: str) -> str:
    name = (username or "").strip()
    if not USERNAME_RE.match(name):
        raise AuthError(
            "Usernames must be 3 to 32 characters, using letters, numbers, dots, "
            "hyphens, or underscores."
        )
    return name


def validate_password(password: str) -> str:
    if len(password or "") < MIN_PASSWORD:
        raise AuthError(f"Passwords must be at least {MIN_PASSWORD} characters.")
    return password


# API key encryption


def derive_enc_key(password: str, enc_salt: bytes) -> bytes:
    raw = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), enc_salt, PBKDF2_ROUNDS, dklen=32
    )
    return base64.urlsafe_b64encode(raw)


def encrypt_secret(secret: str, enc_key: bytes) -> bytes:
    return Fernet(enc_key).encrypt(secret.encode("utf-8"))


def decrypt_secret(blob: bytes, enc_key: bytes) -> Optional[str]:
    try:
        return Fernet(enc_key).decrypt(bytes(blob)).decode("utf-8")
    except (InvalidToken, ValueError, TypeError):
        return None


def key_hint(api_key: str) -> str:
    """A safe fragment to show in Settings so the user knows a key is stored."""
    tail = api_key.strip()[-4:]
    return f"****{tail}" if tail else ""


def provider_for_key(api_key: str) -> str:
    return "anthropic" if api_key.strip().startswith("sk-ant-") else "openai"


def new_enc_salt() -> bytes:
    return secrets.token_bytes(16)


# sessions


@dataclass
class Session:
    user_id: int
    enc_key: Optional[bytes]
    created: float


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class SessionStore:
    """Sessions persisted in the database, with one deliberate exception.

    The key that decrypts a user's own API key is derived from their password and
    is held only in memory. A restart therefore keeps people signed in but forgets
    that derived key, so a user with a personal key re-enters their password to
    use it again. Writing it to disk would defeat the point of encrypting the key.
    """

    def __init__(self) -> None:
        self._enc_keys: Dict[str, bytes] = {}
        self._lock = threading.Lock()

    def create(self, user_id: int, enc_key: Optional[bytes]) -> str:
        token = secrets.token_urlsafe(32)
        digest = token_hash(token)
        created = time.time()

        from backend import store

        store.save_session(digest, user_id, created)
        if enc_key:
            with self._lock:
                self._enc_keys[digest] = enc_key
        return token

    def get(self, token: Optional[str]) -> Optional[Session]:
        if not token:
            return None

        from backend import store

        digest = token_hash(token)
        record = store.load_session(digest)
        if not record:
            return None

        if time.time() - record["created"] > SESSION_TTL_SECONDS:
            store.drop_session(digest)
            with self._lock:
                self._enc_keys.pop(digest, None)
            return None

        with self._lock:
            enc_key = self._enc_keys.get(digest)

        return Session(record["user_id"], enc_key, record["created"])

    def attach_enc_key(self, token: str, enc_key: bytes) -> None:
        with self._lock:
            self._enc_keys[token_hash(token)] = enc_key

    def destroy(self, token: Optional[str]) -> None:
        if not token:
            return

        from backend import store

        digest = token_hash(token)
        store.drop_session(digest)
        with self._lock:
            self._enc_keys.pop(digest, None)

    def destroy_user(self, user_id: int) -> None:
        from backend import store

        store.drop_user_sessions(user_id)
        with self._lock:
            self._enc_keys.clear()

    def rekey(self, user_id: int, enc_key: bytes) -> None:
        """After a password change, live sessions need the new decryption key."""
        from backend import store

        with self._lock:
            for digest in list(self._enc_keys):
                record = store.load_session(digest)
                if record and record["user_id"] == user_id:
                    self._enc_keys[digest] = enc_key

    def purge_expired(self) -> None:
        from backend import store

        store.purge_expired_sessions(time.time() - SESSION_TTL_SECONDS)


sessions = SessionStore()

COOKIE_NAME = "lune_session"


def cookie_secure() -> bool:
    return os.environ.get("LUNE_HTTPS", "").strip().lower() in ("1", "true", "yes", "on")
