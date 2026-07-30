"""Lune — music AI assistant API.

Lune runs on the user's own machine. Accounts, preferences, and chat history are
stored in a local SQLite database, and each account holds its own encrypted API
key, so nobody has to pay for anyone else's usage.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
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
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from backend import accounts, preferences, store
from backend.accounts import COOKIE_NAME, AuthError, Session, sessions
from backend.analyzer import analysis_to_dict, analyze_score
from backend.context import build_score_digest
from backend.fingering import suggest_fingering
from backend.limits import guard
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

MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_SCORE_BYTES = 5 * 1024 * 1024
MAX_MESSAGE_CHARS = 12000
MAX_HISTORY_TURNS = 40

app = FastAPI(title="Lune", version="3.1.0")

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


@app.post("/api/analyze")
async def analyze(
    file: UploadFile = File(...), session: Session = Depends(current_session)
) -> Dict[str, Any]:
    """Structured MusicXML analysis: letters, voices, fingering, dynamics, harmony."""
    if not file.filename:
        raise HTTPException(400, "No file provided")

    suffix = Path(file.filename).suffix.lower()
    if suffix not in SCORE_SUFFIXES:
        raise HTTPException(400, "Upload a MusicXML file (.musicxml, .xml, or .mxl).")

    raw = await file.read()
    if len(raw) > MAX_SCORE_BYTES:
        raise HTTPException(413, "File is larger than 5 MB.")

    prefs = preferences.normalise(store.get_prefs(session.user_id))

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(raw)
        tmp_path = tmp.name

    try:
        analysis = suggest_fingering(
            analyze_score(tmp_path), hand_span=preferences.hand_span(prefs)
        )
        return analysis_to_dict(analysis)
    except Exception as exc:
        raise HTTPException(422, f"Could not parse score: {exc}") from exc
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@app.get("/api/sample")
def sample_score() -> Dict[str, Any]:
    sample_path = SAMPLES / "twinkle.musicxml"
    if not sample_path.exists():
        raise HTTPException(404, "Sample score not found")
    return analysis_to_dict(suggest_fingering(analyze_score(str(sample_path))))


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND / "index.html")


app.mount("/static", StaticFiles(directory=FRONTEND), name="static")
