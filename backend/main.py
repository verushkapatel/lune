"""Lune — music AI assistant API.

Lune runs on the user's own machine. Accounts, preferences, and chat history are
stored in a local SQLite database, and each account holds its own encrypted API
key, so nobody has to pay for anyone else's usage.
"""

from __future__ import annotations

import base64
import copy
import json
import os
import re
import sys
import tempfile
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv

# A packaged build unpacks its data files into a temporary bundle directory.
if getattr(sys, "frozen", False):
    ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
else:
    ROOT = Path(__file__).resolve().parent.parent

load_dotenv(ROOT / ".env")

from fastapi import Cookie, Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from backend import accounts, preferences, store
from backend.accounts import COOKIE_NAME, AuthError, Session, sessions
from backend.analyzer import analysis_to_dict, analyze_score
from backend.coach import coach_payload, measure_debrief, practice_plan
from backend.context import build_score_digest
from backend.discover import piece_overview, search_catalogue
from backend.fingering import suggest_fingering
from backend.limits import guard
from backend.scoresource import (
    list_available,
    resolve_score,
    search_index_json,
    search_library,
    seed_search_index,
    warm_catalogue,
)
from backend.lune import (
    Attachment,
    LuneError,
    encode_image,
    friendly_error,
    server_provider,
    sse,
    stream_reply,
)

FRONTEND = ROOT / "frontend"
SAMPLES = ROOT / "samples"

SCORE_SUFFIXES = {".xml", ".musicxml", ".mxl"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic"}
PDF_SUFFIXES = {".pdf"}
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_SCORE_BYTES = 5 * 1024 * 1024
MAX_PDF_BYTES = 15 * 1024 * 1024
MAX_MESSAGE_CHARS = 12000
MAX_HISTORY_TURNS = 40

# Analyzed piece cache — music21 parse is ~3s; never redo for the same file.
_piece_cache: Dict[str, Dict[str, Any]] = {}
_piece_cache_lock = threading.Lock()
_PIECE_CACHE_MAX = 24

app = FastAPI(title="Lune", version="4.0.0")

# The interface is served from the same origin as the API, so no cross-origin
# access is needed by default. A wildcard origin would in any case be rejected by
# browsers for the credentialed requests Lune makes, and would be unsafe here.
_allowed_origins = [
    origin.strip()
    for origin in os.environ.get("LUNE_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]
if _allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


def signups_open() -> bool:
    return os.environ.get("LUNE_ALLOW_SIGNUP", "").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def invite_code() -> str:
    return os.environ.get("LUNE_INVITE_CODE", "").strip()


@app.on_event("startup")
def startup() -> None:
    store.init_db()
    sessions.purge_expired()
    # Featured index in milliseconds so /api/search/index is ready before any request.
    try:
        seed_search_index()
    except Exception:
        pass

    def _warm() -> None:
        try:
            warm_catalogue()
        except Exception:
            # Catalogue warm is best-effort; search still works on demand.
            pass

    # Expand to full catalogue off the event loop (may import music21).
    import threading

    threading.Thread(target=_warm, daemon=True, name="warm-catalogue").start()


# auth plumbing


def current_session(lune_session: Optional[str] = Cookie(default=None)) -> Session:
    session = sessions.get(lune_session)
    if not session:
        raise HTTPException(401, "Please sign in.")
    return session


def _account_payload(session: Session) -> Dict[str, Any]:
    row = store.get_user(session.user_id)
    if not row:
        raise HTTPException(401, "Account no longer exists.")

    prefs = preferences.normalise(store.get_prefs(session.user_id))
    has_key = row["key_blob"] is not None
    fallback = server_provider()
    # After a restart the key that decrypts a personal API key is gone until the
    # user signs in again, even though their session is still valid.
    locked = has_key and session.enc_key is None
    on_shared = fallback is not None and (not has_key or locked)

    return {
        "username": row["username"],
        "displayName": row["display_name"],
        "preferences": prefs,
        "apiKey": {
            "saved": has_key,
            "hint": row["key_hint"],
            "provider": row["key_provider"],
            "locked": locked,
        },
        "usingSharedKey": on_shared,
        "needsKey": fallback is None and (not has_key or locked),
        "allowance": {
            "metered": on_shared,
            "remaining": guard.remaining(session.user_id) if on_shared else None,
            "perDay": guard.per_user_daily if on_shared else None,
        },
    }


def _decrypted_key(session: Session) -> Optional[str]:
    row = store.get_user(session.user_id)
    if not row or row["key_blob"] is None or session.enc_key is None:
        return None
    return accounts.decrypt_secret(row["key_blob"], session.enc_key)


def _set_cookie(response: JSONResponse, token: str) -> JSONResponse:
    response.set_cookie(
        COOKIE_NAME,
        token,
        httponly=True,
        samesite="lax",
        secure=accounts.cookie_secure(),
        max_age=accounts.SESSION_TTL_SECONDS,
        path="/",
    )
    return response


# auth endpoints


@app.get("/api/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/status")
def status() -> Dict[str, Any]:
    fallback = server_provider()
    return {
        "hasAccounts": store.user_count() > 0,
        "sharedKey": fallback is not None,
        "sharedModel": fallback["model"] if fallback else None,
        "signupsOpen": signups_open(),
        "inviteRequired": bool(invite_code()),
        "limits": {"perDay": guard.per_user_daily},
    }


@app.post("/api/auth/signup")
async def signup(request: Request) -> JSONResponse:
    if not signups_open():
        raise HTTPException(403, "New accounts are closed on this instance.")

    body = await request.json()

    required = invite_code()
    if required and (body.get("inviteCode") or "").strip() != required:
        raise HTTPException(403, "That invite code is not valid.")

    try:
        username = accounts.validate_username(body.get("username", ""))
        password = accounts.validate_password(body.get("password", ""))
    except AuthError as exc:
        raise HTTPException(400, str(exc)) from exc

    if store.find_user(username):
        raise HTTPException(409, "That username is already taken.")

    display = (body.get("displayName") or "").strip()[:60] or username
    pw_hash, pw_salt = accounts.hash_password(password)
    enc_salt = accounts.new_enc_salt()

    user_id = store.create_user(
        username, display, pw_hash, pw_salt, enc_salt, preferences.DEFAULTS
    )
    token = sessions.create(user_id, accounts.derive_enc_key(password, enc_salt))

    session = sessions.get(token)
    assert session is not None
    return _set_cookie(JSONResponse(_account_payload(session)), token)


@app.post("/api/auth/login")
async def login(request: Request) -> JSONResponse:
    body = await request.json()
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""

    row = store.find_user(username)
    if not row or not accounts.verify_password(password, row["pw_hash"], row["pw_salt"]):
        raise HTTPException(401, "Wrong username or password.")

    token = sessions.create(
        int(row["id"]), accounts.derive_enc_key(password, row["enc_salt"])
    )
    session = sessions.get(token)
    assert session is not None
    return _set_cookie(JSONResponse(_account_payload(session)), token)


@app.post("/api/auth/logout")
def logout(lune_session: Optional[str] = Cookie(default=None)) -> JSONResponse:
    sessions.destroy(lune_session)
    response = JSONResponse({"ok": True})
    response.delete_cookie(COOKIE_NAME, path="/")
    return response


@app.get("/api/me")
def me(session: Session = Depends(current_session)) -> Dict[str, Any]:
    return _account_payload(session)


# preferences and account settings


@app.put("/api/preferences")
async def update_preferences(
    request: Request, session: Session = Depends(current_session)
) -> Dict[str, Any]:
    body = await request.json()
    prefs = preferences.normalise(body.get("preferences") or {})
    store.set_prefs(session.user_id, prefs)
    return {"preferences": prefs}


@app.put("/api/account/profile")
async def update_profile(
    request: Request, session: Session = Depends(current_session)
) -> Dict[str, Any]:
    body = await request.json()
    display = (body.get("displayName") or "").strip()[:60]
    if not display:
        raise HTTPException(400, "Display name cannot be empty.")
    with store.connect() as conn:
        conn.execute(
            "UPDATE users SET display_name = ? WHERE id = ?", (display, session.user_id)
        )
    return _account_payload(session)


@app.put("/api/account/key")
async def update_key(
    request: Request, session: Session = Depends(current_session)
) -> Dict[str, Any]:
    body = await request.json()
    api_key = (body.get("apiKey") or "").strip()

    if not api_key:
        store.set_api_key(session.user_id, None, "", "")
        return _account_payload(session)

    if len(api_key) < 20 or " " in api_key:
        raise HTTPException(400, "That does not look like an API key.")

    blob = accounts.encrypt_secret(api_key, session.enc_key)
    store.set_api_key(
        session.user_id,
        blob,
        accounts.provider_for_key(api_key),
        accounts.key_hint(api_key),
    )
    return _account_payload(session)


@app.put("/api/account/password")
async def change_password(
    request: Request, session: Session = Depends(current_session)
) -> Dict[str, Any]:
    body = await request.json()
    current = body.get("currentPassword") or ""
    replacement = body.get("newPassword") or ""

    row = store.get_user(session.user_id)
    if not row or not accounts.verify_password(current, row["pw_hash"], row["pw_salt"]):
        raise HTTPException(401, "Your current password is not correct.")

    try:
        accounts.validate_password(replacement)
    except AuthError as exc:
        raise HTTPException(400, str(exc)) from exc

    has_key = row["key_blob"] is not None
    if has_key and session.enc_key is None:
        raise HTTPException(
            409,
            "Sign out and sign in again before changing your password, so your "
            "saved API key can be re-encrypted rather than lost.",
        )

    # The stored API key is encrypted from the password, so it has to be
    # re-encrypted under the new one or it would become unreadable.
    plain_key = _decrypted_key(session)
    new_enc_salt = accounts.new_enc_salt()
    new_enc_key = accounts.derive_enc_key(replacement, new_enc_salt)

    pw_hash, pw_salt = accounts.hash_password(replacement)
    store.set_password(session.user_id, pw_hash, pw_salt)
    with store.connect() as conn:
        conn.execute(
            "UPDATE users SET enc_salt = ? WHERE id = ?", (new_enc_salt, session.user_id)
        )

    if plain_key:
        store.set_api_key(
            session.user_id,
            accounts.encrypt_secret(plain_key, new_enc_key),
            accounts.provider_for_key(plain_key),
            accounts.key_hint(plain_key),
        )

    sessions.rekey(session.user_id, new_enc_key)
    session.enc_key = new_enc_key
    return {"ok": True}


@app.delete("/api/account")
def delete_account(session: Session = Depends(current_session)) -> JSONResponse:
    store.delete_user(session.user_id)
    sessions.destroy_user(session.user_id)
    response = JSONResponse({"ok": True})
    response.delete_cookie(COOKIE_NAME, path="/")
    return response


# chat history


@app.get("/api/threads")
def threads(session: Session = Depends(current_session)) -> Dict[str, Any]:
    return {"threads": store.list_threads(session.user_id)}


@app.post("/api/threads")
def new_thread(session: Session = Depends(current_session)) -> Dict[str, Any]:
    thread_id = store.create_thread(session.user_id)
    return {"id": thread_id, "title": "New chat", "messages": []}


@app.get("/api/threads/{thread_id}")
def read_thread(
    thread_id: str, session: Session = Depends(current_session)
) -> Dict[str, Any]:
    if not store.owns_thread(session.user_id, thread_id):
        raise HTTPException(404, "Conversation not found.")
    return {"id": thread_id, "messages": store.get_messages(session.user_id, thread_id)}


@app.delete("/api/threads/{thread_id}")
def remove_thread(
    thread_id: str, session: Session = Depends(current_session)
) -> Dict[str, Any]:
    store.delete_thread(session.user_id, thread_id)
    return {"ok": True}


# analysis helpers


def _analyze_to_digest(raw: bytes, suffix: str, prefs: Dict[str, Any]) -> str:
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(raw)
        tmp_path = tmp.name
    try:
        analysis = suggest_fingering(
            analyze_score(tmp_path), hand_span=preferences.hand_span(prefs)
        )
        return build_score_digest(analysis, max_measures=preferences.detail_bars(prefs))
    finally:
        Path(tmp_path).unlink(missing_ok=True)


async def _build_attachments(
    files: List[UploadFile], prefs: Dict[str, Any]
) -> List[Attachment]:
    attachments: List[Attachment] = []

    for upload in files:
        if not upload.filename:
            continue

        suffix = Path(upload.filename).suffix.lower()
        raw = await upload.read()

        if suffix in IMAGE_SUFFIXES:
            if len(raw) > MAX_IMAGE_BYTES:
                raise HTTPException(
                    413,
                    f"{upload.filename} is larger than 10 MB. Please send a smaller photo.",
                )
            attachment = encode_image(raw, upload.content_type or "image/png")
            attachment.filename = upload.filename
            attachments.append(attachment)

        elif suffix in SCORE_SUFFIXES:
            if len(raw) > MAX_SCORE_BYTES:
                raise HTTPException(413, f"{upload.filename} is larger than 5 MB.")
            try:
                digest = _analyze_to_digest(raw, suffix, prefs)
            except Exception as exc:
                digest = (
                    f"The file {upload.filename} could not be parsed ({exc}). Tell the user the "
                    "file may be corrupt or an unusual MusicXML dialect, and offer to work from "
                    "a photo instead."
                )
            attachments.append(Attachment(kind="score", digest=digest, filename=upload.filename))

        elif suffix == ".pdf":
            attachments.append(
                Attachment(
                    kind="score",
                    filename=upload.filename,
                    digest=(
                        f"The user attached a PDF ({upload.filename}), which cannot be read "
                        "directly. Ask for a screenshot or photo of the relevant page, or "
                        "MusicXML exported from their notation software."
                    ),
                )
            )
        else:
            attachments.append(
                Attachment(
                    kind="score",
                    filename=upload.filename,
                    digest=f"Unsupported attachment type: {upload.filename}",
                )
            )

    return attachments


def _title_from(text: str) -> str:
    clean = " ".join(text.split())
    if len(clean) <= 44:
        return clean or "New chat"
    return clean[:44].rsplit(" ", 1)[0] + "..."


@app.post("/api/chat")
async def chat(
    request: Request,
    payload: str = Form(...),
    files: Optional[List[UploadFile]] = File(None),
    session: Session = Depends(current_session),
) -> StreamingResponse:
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise HTTPException(400, f"Invalid payload: {exc}") from exc

    content = (parsed.get("content") or "").strip()[:MAX_MESSAGE_CHARS]
    thread_id = parsed.get("threadId") or ""
    uploads = files or []

    if not content and not uploads:
        raise HTTPException(400, "Nothing to send.")
    if not content:
        content = "I've attached a page of music. Read it and tell me what you see."

    if not thread_id or not store.owns_thread(session.user_id, thread_id):
        thread_id = store.create_thread(session.user_id)

    user_row = store.get_user(session.user_id)
    if not user_row:
        raise HTTPException(401, "Account no longer exists.")

    prefs = preferences.normalise(store.get_prefs(session.user_id))
    api_key = _decrypted_key(session)

    # Only meter requests that spend the operator's key; a user's own key is
    # their own expense and is never rationed.
    metered = api_key is None and server_provider() is not None
    if metered:
        allowed, message = guard.check(session.user_id)
        if not allowed:
            raise HTTPException(429, message or "Daily limit reached")
        guard.record(session.user_id)

    attachments = await _build_attachments(uploads, prefs)

    history = store.get_messages(session.user_id, thread_id)[-MAX_HISTORY_TURNS:]
    history = [{"role": m["role"], "content": m["content"]} for m in history]
    history.append({"role": "user", "content": content})

    file_meta = [{"name": u.filename} for u in uploads if u.filename]
    is_first = not store.get_messages(session.user_id, thread_id)
    store.add_message(session.user_id, thread_id, "user", content, file_meta)
    if is_first:
        store.rename_thread(session.user_id, thread_id, _title_from(content))

    provider_pref, model_pref = preferences.resolve_model(
        prefs, user_row["key_provider"]
    )
    system_extra = preferences.preferences_prompt(prefs, user_row["display_name"])

    def event_stream():
        answer: List[str] = []
        try:
            for chunk in stream_reply(
                history,
                attachments,
                api_key,
                system_extra=system_extra,
                provider_override=provider_pref if api_key else "",
                model_override=model_pref,
            ):
                answer.append(chunk)
                yield sse("delta", {"text": chunk})

            if not answer:
                yield sse("error", {"message": "The model returned nothing. Please try again."})
            else:
                store.add_message(
                    session.user_id, thread_id, "assistant", "".join(answer)
                )
                yield sse(
                    "done",
                    {
                        "threadId": thread_id,
                        "remaining": guard.remaining(session.user_id) if metered else None,
                    },
                )
        except LuneError as exc:
            yield sse("error", {"message": str(exc)})
        except Exception as exc:  # pragma: no cover
            yield sse("error", {"message": friendly_error(exc)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "X-Thread-Id": thread_id,
        },
    )


def _piece_from_path(
    path: Path,
    hand_span: str = "medium",
    filename: str = "",
    meta: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    analysis = suggest_fingering(analyze_score(str(path)), hand_span=hand_span)
    payload = analysis_to_dict(analysis)
    payload.update(coach_payload(analysis))
    try:
        payload["musicxml"] = path.read_text(encoding="utf-8")
    except Exception:
        payload["musicxml"] = ""
    payload["filename"] = filename or path.name
    payload["kind"] = "score"
    meta = meta or {}
    title = meta.get("title") or payload.get("title") or ""
    composer = meta.get("composer") or payload.get("composer") or ""
    epoch = meta.get("epoch") or meta.get("era") or ""
    portrait = meta.get("portrait") or ""
    payload["overview"] = piece_overview(
        title, composer, payload, epoch=epoch, portrait=portrait
    )
    if epoch:
        payload["epoch"] = epoch
        payload["era"] = epoch
    # Keep a compact debrief map so the UI can open any clicked bar instantly.
    payload["debriefs"] = {
        str(m.number): measure_debrief(analysis, m.number) for m in analysis.measures
    }
    payload["downloadName"] = re.sub(
        r"[^A-Za-z0-9._-]+",
        "_",
        (title or payload.get("filename") or "score"),
    ).strip("_")[:80] + ".musicxml"
    payload["needsAnalysis"] = False
    return payload


def _piece_cache_key(path: Path, hand_span: str) -> str:
    try:
        mtime = path.stat().st_mtime_ns
    except OSError:
        mtime = 0
    return f"{path.resolve()}:{hand_span}:{mtime}"


# Analysis survives restarts: a long score is analysed once per file version.
_ANALYSIS_CACHE_VERSION = "a2"
_DISK_CACHE_DIR = Path(os.environ.get("LUNE_CACHE_DIR") or (Path.home() / ".cache" / "lune" / "analysis"))


def _disk_cache_path(key: str) -> Path:
    import hashlib

    digest = hashlib.sha1(f"{_ANALYSIS_CACHE_VERSION}|{key}".encode("utf-8")).hexdigest()
    return _DISK_CACHE_DIR / f"{digest}.json"


def _disk_cache_get(key: str) -> Optional[Dict[str, Any]]:
    try:
        target = _disk_cache_path(key)
        if not target.exists():
            return None
        return json.loads(target.read_text(encoding="utf-8"))
    except Exception:
        return None


def _disk_cache_put(key: str, payload: Dict[str, Any]) -> None:
    try:
        _DISK_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        target = _disk_cache_path(key)
        tmp = target.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload), encoding="utf-8")
        tmp.replace(target)
    except Exception:
        pass  # cache is an optimisation only


def _piece_from_path_cached(
    path: Path,
    hand_span: str = "medium",
    filename: str = "",
    meta: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Full analysis with LRU cache — second open of the same score is instant."""
    key = _piece_cache_key(path, hand_span)
    with _piece_cache_lock:
        hit = _piece_cache.get(key)
    if hit is None:
        hit = _disk_cache_get(key)
        if hit is not None:
            with _piece_cache_lock:
                _piece_cache[key] = hit
    if hit is not None:
        payload = copy.deepcopy(hit)
    else:
        payload = _piece_from_path(path, hand_span=hand_span, filename=filename, meta=meta)
        _disk_cache_put(key, payload)
        with _piece_cache_lock:
            _piece_cache[key] = copy.deepcopy(payload)
            while len(_piece_cache) > _PIECE_CACHE_MAX:
                _piece_cache.pop(next(iter(_piece_cache)))
    # Overlay request-specific display meta without busting the analysis cache.
    meta = meta or {}
    if meta.get("title"):
        payload["title"] = meta["title"]
    if meta.get("composer"):
        payload["composer"] = meta["composer"]
    if meta.get("epoch") or meta.get("era"):
        epoch = meta.get("epoch") or meta.get("era") or ""
        payload["epoch"] = epoch
        payload["era"] = epoch
    if meta.get("portrait") or meta.get("title") or meta.get("composer"):
        payload["overview"] = piece_overview(
            meta.get("title") or payload.get("title") or "",
            meta.get("composer") or payload.get("composer") or "",
            payload,
            epoch=meta.get("epoch") or meta.get("era") or "",
            portrait=meta.get("portrait") or "",
        )
    if filename:
        payload["filename"] = filename
    payload["needsAnalysis"] = False
    return payload


def _piece_light_from_path(
    path: Path,
    filename: str = "",
    meta: Optional[Dict[str, str]] = None,
    source: str = "",
) -> Dict[str, Any]:
    """Discover-page payload: MusicXML + overview only — no music21 (ms, not seconds)."""
    meta = meta or {}
    try:
        musicxml = path.read_text(encoding="utf-8")
    except Exception:
        musicxml = ""
    title = meta.get("title") or ""
    composer = meta.get("composer") or ""
    epoch = meta.get("epoch") or meta.get("era") or ""
    portrait = meta.get("portrait") or ""
    if not title:
        title = path.stem.replace("_", " ")
    overview = piece_overview(
        title, composer, epoch=epoch, portrait=portrait, remote=False
    )
    download = re.sub(r"[^A-Za-z0-9._-]+", "_", title or path.name).strip("_")[:80] + ".musicxml"
    return {
        "kind": "score",
        "opened": True,
        "needsAnalysis": True,
        "title": title,
        "composer": composer,
        "filename": filename or path.name,
        "musicxml": musicxml,
        "overview": overview,
        "epoch": epoch,
        "era": epoch,
        "debriefs": {},
        "source": source,
        "downloadName": download,
    }


def _piece_from_bytes(
    raw: bytes,
    suffix: str,
    hand_span: str = "medium",
    filename: str = "",
    meta: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(raw)
        tmp_path = tmp.name
    try:
        # Temp uploads are deleted after return — do not cache by path.
        return _piece_from_path(
            Path(tmp_path), hand_span=hand_span, filename=filename, meta=meta
        )
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def _scan_payload(raw: bytes, media_type: str, filename: str) -> Dict[str, Any]:
    encoded = base64.b64encode(raw).decode("ascii")
    return {
        "kind": "scan",
        "filename": filename,
        "title": Path(filename).stem.replace("_", " ").replace("-", " "),
        "composer": "",
        "mediaType": media_type,
        "dataUrl": f"data:{media_type};base64,{encoded}",
        "overview": piece_overview(Path(filename).stem, ""),
        "hint": (
            "Click anywhere you want help. For letter names, voices, and fingering "
            "on the exact notes, export MusicXML from MuseScore and open that too."
        ),
    }


@app.get("/api/search/index")
def search_index_endpoint() -> Response:
    """Serve the prebaked static typeahead index — zero catalogue work."""
    static_path = FRONTEND / "search-index.json"
    if static_path.exists():
        return FileResponse(
            static_path,
            media_type="application/json",
            headers={"Cache-Control": "public, max-age=3600"},
        )
    body = search_index_json()
    return Response(
        content=body,
        media_type="application/json",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/search")
def search_pieces(q: str = "", remote: int = 0) -> Dict[str, Any]:
    # Free scores first so openable pieces always win over catalogue-only hits.
    # Default remote=0 keeps typed search local/fast; OpenOpus is opt-in.
    free = search_library(q, limit=20)
    merged = list(free)
    if remote:
        remote_hits = search_catalogue(q)
        seen = {(r.get("title"), r.get("composer")) for r in free}
        for row in remote_hits:
            key = (row.get("title"), row.get("composer"))
            if key in seen:
                continue
            seen.add(key)
            merged.append(row)
    return {"results": merged[:24], "openableCount": len(free)}


@app.get("/api/library")
def free_library(q: str = "", full: int = 0) -> Dict[str, Any]:
    """Free scores Lune can open without an upload.

    Default (no q): curated piano collections only — keeps the home page fast.
    With q= or full=1: full catalogue (chorales, music21 corpus, etc.).
    """
    items = list_available()
    needle = (q or "").strip().lower()
    curated_prefixes = (
        "Featured",
        "Open MusicXML",
        "OpenScore",
        "Liszt",
        "Scriabin",
        "Beethoven piano",
        "Mozart piano",
        "Haydn piano",
        "Chopin",
        "Joplin",
        "Scarlatti",
        "Hummel",
        "Bach · Art",
        "Bach · Well-Tempered",
        "Bach · Inventions",
        "Bach · Sinfonias",
        "Beethoven string",
    )
    if needle:
        items = [
            item
            for item in items
            if needle in (item.get("title") or "").lower()
            or needle in (item.get("composer") or "").lower()
            or needle in (item.get("query") or "").lower()
            or needle in (item.get("group") or "").lower()
        ]
    elif not full:
        items = [
            item
            for item in items
            if any((item.get("group") or "").startswith(p) for p in curated_prefixes)
        ]
    groups: Dict[str, List[Dict[str, str]]] = {}
    for item in items:
        groups.setdefault(item["group"], []).append(item)
    # list_available is cached; call once for total when we already filtered.
    total_all = len(list_available()) if (needle or not full) else len(items)
    return {
        "items": items,
        "groups": groups,
        "count": len(items),
        "totalAvailable": total_all,
    }


@app.post("/api/search/open")
async def open_searched_piece(request: Request) -> Dict[str, Any]:
    """Search result → open score.

    Default is a *light* open (MusicXML + overview, no music21) so Discover
    lands in milliseconds. Pass analyze=true when entering Listen / Ask.
    """
    body = await request.json()
    title = (body.get("title") or "").strip()
    composer = (body.get("composer") or "").strip()
    epoch = (body.get("epoch") or body.get("era") or "").strip()
    query = (body.get("query") or body.get("q") or "").strip()
    portrait = (body.get("portrait") or "").strip()
    analyze = bool(body.get("analyze"))
    if not title and not composer and not query:
        raise HTTPException(400, "Nothing to open.")

    resolved = resolve_score(title, composer, query=query)
    if not resolved and query:
        resolved = resolve_score(query, "", query=query)
    if not resolved:
        return {
            "kind": "catalogue",
            "opened": False,
            "title": title or query,
            "composer": composer,
            "overview": piece_overview(
                title or query, composer, epoch=epoch, portrait=portrait
            ),
            "message": (
                "No free MusicXML for this exact title yet. Search for a known free "
                "piece (Chopin Mazurka, Für Elise, Raindrop, Clair de Lune, The Entertainer…), "
                "or open your own MusicXML / PDF / photo."
            ),
        }

    meta = {
        "title": title or resolved["title"],
        "composer": composer or resolved["composer"],
        "epoch": epoch,
        "portrait": portrait,
    }
    path = Path(resolved["path"])
    if analyze:
        # music21 parse is multi-second — never block the event loop.
        piece = await run_in_threadpool(
            _piece_from_path_cached,
            path,
            "medium",
            path.name,
            meta,
        )
    else:
        piece = _piece_light_from_path(
            path,
            filename=path.name,
            meta=meta,
            source=resolved["source"],
        )
    piece["opened"] = True
    piece["source"] = resolved["source"]
    piece["downloadName"] = _download_name(piece)
    piece["openQuery"] = query
    if resolved.get("fallbackNote"):
        piece["fallbackNote"] = resolved["fallbackNote"]
    return piece


def _download_name(piece: Dict[str, Any]) -> str:
    base = piece.get("title") or piece.get("filename") or "score"
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("_") or "score"
    return f"{safe[:80]}.musicxml"


@app.get("/api/overview")
def overview(title: str = "", composer: str = "", epoch: str = "") -> Dict[str, Any]:
    return piece_overview(title, composer, epoch=epoch)


@app.post("/api/piece")
async def open_piece(
    file: UploadFile = File(...),
    title: str = Form(""),
    composer: str = Form(""),
) -> Dict[str, Any]:
    """Open MusicXML, PDF, or a photo/scan of a page."""
    if not file.filename:
        raise HTTPException(400, "No file provided")

    suffix = Path(file.filename).suffix.lower()
    raw = await file.read()
    meta = {"title": title.strip(), "composer": composer.strip()}

    if suffix in SCORE_SUFFIXES:
        if len(raw) > MAX_SCORE_BYTES:
            raise HTTPException(413, "File is larger than 5 MB.")
        try:
            return _piece_from_bytes(raw, suffix, filename=file.filename, meta=meta)
        except Exception as exc:
            raise HTTPException(422, f"Could not parse score: {exc}") from exc

    if suffix in IMAGE_SUFFIXES:
        if len(raw) > MAX_IMAGE_BYTES:
            raise HTTPException(413, "Image is larger than 10 MB.")
        media = file.content_type or f"image/{suffix.lstrip('.')}"
        return _scan_payload(raw, media, file.filename)

    if suffix in PDF_SUFFIXES:
        if len(raw) > MAX_PDF_BYTES:
            raise HTTPException(413, "PDF is larger than 15 MB.")
        return _scan_payload(raw, "application/pdf", file.filename)

    raise HTTPException(
        400,
        "Open a MusicXML score, a PDF, or a photo of the page (.png, .jpg, .webp).",
    )


@app.get("/api/piece/sample")
def sample_piece() -> Dict[str, Any]:
    sample_path = SAMPLES / "twinkle.musicxml"
    if not sample_path.exists():
        raise HTTPException(404, "Sample score not found")
    return _piece_from_path(
        sample_path,
        filename=sample_path.name,
        meta={"title": "Twinkle Twinkle Little Star", "composer": "Traditional"},
    )


@app.post("/api/piece/practice")
async def ask_practice(request: Request) -> Dict[str, Any]:
    """Build a practice plan only when the musician asks."""
    body = await request.json()
    bars = body.get("bars") or []
    # Re-open from uploaded musicxml string if provided; otherwise require sample path data.
    musicxml = body.get("musicxml") or ""
    if not musicxml:
        raise HTTPException(400, "Open a MusicXML score first to build a practice plan.")
    raw = musicxml.encode("utf-8")
    with tempfile.NamedTemporaryFile(suffix=".musicxml", delete=False) as tmp:
        tmp.write(raw)
        tmp_path = tmp.name
    try:
        analysis = suggest_fingering(analyze_score(tmp_path))
        focus = [int(b) for b in bars if str(b).isdigit()] or None
        return practice_plan(analysis, focus)
    except Exception as exc:
        raise HTTPException(422, f"Could not build a plan: {exc}") from exc
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)) -> Dict[str, Any]:
    if not file.filename:
        raise HTTPException(400, "No file provided")
    suffix = Path(file.filename).suffix.lower()
    raw = await file.read()
    if suffix not in SCORE_SUFFIXES:
        raise HTTPException(400, "Upload a MusicXML file.")
    piece = _piece_from_bytes(raw, suffix, filename=file.filename)
    return {key: piece[key] for key in piece if key not in ("musicxml", "dataUrl", "debriefs")}


@app.get("/api/sample")
def sample_score() -> Dict[str, Any]:
    piece = sample_piece()
    return {key: piece[key] for key in piece if key not in ("musicxml", "dataUrl")}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND / "index.html")


app.mount("/static", StaticFiles(directory=FRONTEND), name="static")
