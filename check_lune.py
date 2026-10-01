"""Offline checks for Lune. No API key required."""

import base64
import json
import os
import tempfile
from pathlib import Path

# Point the database at a throwaway directory before anything imports the store,
# so running the checks never touches a real installation's accounts.
_TEST_DATA_DIR = tempfile.mkdtemp(prefix="lune-check-")
os.environ["LUNE_DATA_DIR"] = _TEST_DATA_DIR
os.environ.pop("OPENAI_API_KEY", None)
os.environ.pop("ANTHROPIC_API_KEY", None)

import music21

import backend.main as main
from backend import accounts, preferences, store
from backend.analyzer import analyze_score
from backend.context import build_score_digest
from backend.fingering import _span, _state, suggest_fingering
from backend.lune import Attachment, _anthropic_messages, _openai_messages, encode_image

# Importing backend.main loads .env, which may put a real key back into the
# environment. Clear it again so the checks never bill anyone and so tests that
# assume "no shared key" behave the same on every machine.
os.environ.pop("OPENAI_API_KEY", None)
os.environ.pop("ANTHROPIC_API_KEY", None)

ROOT = Path(__file__).resolve().parent
SAMPLE = ROOT / "samples" / "twinkle.musicxml"

passed = 0
failed = 0


def check(label, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  ok    {label}")
    else:
        failed += 1
        print(f"  FAIL  {label} {detail}")


def build(events):
    score = music21.stream.Score()
    part = music21.stream.Part()
    for event in events:
        if isinstance(event, list):
            part.append(music21.chord.Chord(event, quarterLength=1))
        else:
            part.append(music21.note.Note(event, quarterLength=1))
    score.insert(0, part)
    handle = tempfile.NamedTemporaryFile(suffix=".musicxml", delete=False)
    handle.close()
    score.write("musicxml", fp=handle.name)
    return handle.name


def fingers(events):
    path = build(events)
    try:
        analysis = suggest_fingering(analyze_score(path))
        return [n.fingering for m in analysis.measures for n in m.notes]
    finally:
        Path(path).unlink(missing_ok=True)


def test_fingering():
    print("fingering")
    check(
        "C major ascending is 1 2 3 1 2 3 4 5",
        fingers(["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"]) == [1, 2, 3, 1, 2, 3, 4, 5],
    )
    check(
        "C major descending is 5 4 3 2 1 3 2 1",
        fingers(["C5", "B4", "A4", "G4", "F4", "E4", "D4", "C4"]) == [5, 4, 3, 2, 1, 3, 2, 1],
    )
    check(
        "F major keeps the thumb off B flat",
        fingers(["F4", "G4", "A4", "B-4", "C5", "D5", "E5", "F5"]) == [1, 2, 3, 4, 1, 2, 3, 4],
    )

    path = build(["E-4", "F4", "G4", "A-4", "B-4", "C5", "D5", "E-5"])
    try:
        analysis = suggest_fingering(analyze_score(path))
        thumbed_black = [
            n.pitch for m in analysis.measures for n in m.notes if n.fingering == 1 and n.is_black_key
        ]
        check("no thumb on a black key in E flat major", not thumbed_black, str(thumbed_black))
    finally:
        Path(path).unlink(missing_ok=True)

    check(
        "root triad takes 1 3 5",
        fingers([["C4", "E4", "G4"]]) == [5, 3, 1],
        "(reported high to low)",
    )
    check("octave takes 1 and 5", fingers([["C4", "C5"]]) == [5, 1])

    path = build(["E4", "E4", "E4", "D4", "D4"])
    try:
        analysis = suggest_fingering(analyze_score(path))
        notes = [n for m in analysis.measures for n in m.notes]
        slides = [
            (a.pitch, b.pitch)
            for a, b in zip(notes, notes[1:])
            if a.fingering == b.fingering and 0 < abs(a.midi - b.midi) <= 2
        ]
        check("no same finger slid across a step", not slides, str(slides))
    finally:
        Path(path).unlink(missing_ok=True)


def test_analysis():
    print("analysis")
    analysis = suggest_fingering(analyze_score(str(SAMPLE)))

    check("title read from the file", analysis.title.startswith("Twinkle"))
    check("written key signature reported", "no accidentals" in analysis.notated_key)
    check("estimated key kept separate", analysis.analyzed_key == "C major")

    chord_measure = next((m for m in analysis.measures if any(n.is_chord_member for n in m.notes)), None)
    check("chord found in the sample", chord_measure is not None)
    if chord_measure:
        members = sorted(
            [n for n in chord_measure.notes if n.is_chord_member], key=lambda n: -n.midi
        )
        check(
            "voice 1 is the highest note of a chord",
            members[0].voice == 1 and members[0].midi == max(n.midi for n in members),
            f"top={members[0].pitch} voice={members[0].voice}",
        )

    monophonic = build(["C4", "D4", "E4"])
    try:
        mono = analyze_score(monophonic)
        check(
            "no roman numerals invented from single notes",
            all(not m.harmony for m in mono.measures),
        )
    finally:
        Path(monophonic).unlink(missing_ok=True)

    triads = build([["C4", "E4", "G4"], ["G4", "B4", "D5"]])
    try:
        chorded = analyze_score(triads)
        romans = [h.roman for m in chorded.measures for h in m.harmony]
        check("real triads get roman numerals", any(r for r in romans), str(romans))
    finally:
        Path(triads).unlink(missing_ok=True)


def test_digest():
    print("score context")
    analysis = suggest_fingering(analyze_score(str(SAMPLE)))
    digest = build_score_digest(analysis)

    check("written key labelled", "Written key signature" in digest)
    check("estimate flagged as a guess", "statistical guess" in digest)
    check("fingering source disclosed", "span-cost solver" in digest)
    check("bars present", "m.1" in digest and "m.5" in digest)

    short = build_score_digest(analysis, max_measures=2)
    check("truncation disclosed", "Full note detail above covers" in short)
    check("outline still lists later bars", "m.5" in short)


def test_preferences():
    print("preferences")
    prefs = preferences.normalise(
        {"instrument": "guitar", "detailBars": 9999, "verbosity": "nonsense", "junk": 1}
    )
    check("unknown fields dropped", "junk" not in prefs)
    check("valid choice kept", prefs["instrument"] == "guitar")
    check("invalid choice falls back", prefs["verbosity"] == "balanced")
    check("detail bars clamped", prefs["detailBars"] == 400)

    prompt = preferences.preferences_prompt(prefs, "Ada")
    check("prompt names the user", "Ada" in prompt)
    check("prompt carries the instrument", "guitar" in prompt.lower())
    check(
        "guitar users are not given piano fingering",
        "never give piano finger numbers" in prompt,
    )

    singer = preferences.preferences_prompt(
        preferences.normalise({"instrument": "voice", "noteNames": "german"})
    )
    check("solfege/german naming reaches the prompt", "H" in singer and "German" in singer)

    try:
        _state.span_scale = preferences.HAND_SPAN_SCALE["small"]
        small = _span(1, 5)[1]
        _state.span_scale = preferences.HAND_SPAN_SCALE["large"]
        large = _span(1, 5)[1]
    finally:
        _state.span_scale = 1.0
    check("hand span changes the modelled reach", small < large, f"{small} vs {large}")


def test_accounts():
    print("accounts")
    store.init_db()

    digest, salt = accounts.hash_password("correct horse")
    check("password verifies", accounts.verify_password("correct horse", digest, salt))
    check("wrong password rejected", not accounts.verify_password("nope", digest, salt))

    enc_salt = accounts.new_enc_salt()
    key = accounts.derive_enc_key("correct horse", enc_salt)
    blob = accounts.encrypt_secret("sk-secret-value-1234567890", key)
    check("key round trips", accounts.decrypt_secret(blob, key) == "sk-secret-value-1234567890")
    check(
        "key unreadable with the wrong password",
        accounts.decrypt_secret(blob, accounts.derive_enc_key("other", enc_salt)) is None,
    )
    check("key not stored in the clear", b"sk-secret-value" not in blob)

    check("anthropic keys detected", accounts.provider_for_key("sk-ant-abc") == "anthropic")
    check("openai keys detected", accounts.provider_for_key("sk-abc") == "openai")
    check("hint hides the key", accounts.key_hint("sk-abcdefgh7890") == "****7890")

    try:
        accounts.validate_username("no")
        short_ok = True
    except accounts.AuthError:
        short_ok = False
    check("short usernames rejected", not short_ok)

    try:
        accounts.validate_password("tiny")
        weak_ok = True
    except accounts.AuthError:
        weak_ok = False
    check("short passwords rejected", not weak_ok)


def test_transport():
    print("api")
    from fastapi.testclient import TestClient

    def fake_stream(
        history,
        attachments,
        api_key=None,
        system_extra="",
        provider_override="",
        model_override="",
    ):
        grounded = any(a.kind == "score" for a in attachments)
        yield "reading "
        yield "grounded" if grounded else "no-score"

    def collect(body):
        return "".join(
            json.loads(line.split("data: ", 1)[1]).get("text", "")
            for line in body.splitlines()
            if line.startswith("data: ") and '"text"' in line
        )

    original = main.stream_reply
    main.stream_reply = fake_stream

    try:
        client = TestClient(main.app)

        status = client.get("/api/status").json()
        check("status reports account state", "hasAccounts" in status and "limits" in status)

        check(
            "chat requires an account",
            client.post(
                "/api/chat", data={"payload": json.dumps({"content": "hi"})}
            ).status_code
            == 401,
        )

        created = client.post(
            "/api/auth/signup",
            json={"username": "checker", "password": "checker-pass", "displayName": "Checker"},
        )
        check("signup succeeds", created.status_code == 200, created.text)
        check("new account has default preferences", created.json()["preferences"]["instrument"] == "piano")

        check(
            "duplicate usernames refused",
            client.post(
                "/api/auth/signup", json={"username": "checker", "password": "another-pass"}
            ).status_code
            == 409,
        )

        response = client.post(
            "/api/chat",
            data={"payload": json.dumps({"content": "hi"})},
            files=[("files", ("twinkle.musicxml", SAMPLE.read_bytes()))],
        )
        check(
            "musicxml reaches the model as score data",
            collect(response.text) == "reading grounded",
            collect(response.text),
        )
        check("stream terminates cleanly", "event: done" in response.text)

        png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="
        )
        response = client.post(
            "/api/chat",
            data={"payload": json.dumps({"content": "read"})},
            files=[("files", ("page.png", png, "image/png"))],
        )
        check("images take the vision path", collect(response.text) == "reading no-score")

        check(
            "empty message rejected",
            client.post("/api/chat", data={"payload": json.dumps({"content": ""})}).status_code
            == 400,
        )

        listing = client.get("/api/threads").json()["threads"]
        check("conversations are saved to the account", len(listing) >= 2, str(len(listing)))
        check("threads get titled from the first message", any(t["title"] == "hi" for t in listing))

        thread_id = listing[0]["id"]
        messages = client.get(f"/api/threads/{thread_id}").json()["messages"]
        check("history stores both sides", len(messages) == 2 and messages[0]["role"] == "user")

        saved = client.put(
            "/api/preferences", json={"preferences": {"instrument": "violin", "verbosity": "concise"}}
        )
        check("preferences persist", saved.json()["preferences"]["instrument"] == "violin")
        check(
            "preferences survive a reload",
            client.get("/api/me").json()["preferences"]["instrument"] == "violin",
        )

        client.put("/api/account/key", json={"apiKey": "sk-ant-test-key-abcdefghijklmnop"})
        me = client.get("/api/me").json()
        check("saved key is reported without exposing it", me["apiKey"]["saved"] and "test-key" not in json.dumps(me))

        with store.connect() as conn:
            row = conn.execute("SELECT key_blob FROM users WHERE username = 'checker'").fetchone()
        check("key is encrypted in the database", b"sk-ant-test-key" not in bytes(row["key_blob"]))

        client.put(
            "/api/account/password",
            json={"currentPassword": "checker-pass", "newPassword": "brand-new-pass"},
        )
        client.post("/api/auth/logout")
        check(
            "old password no longer works",
            client.post(
                "/api/auth/login", json={"username": "checker", "password": "checker-pass"}
            ).status_code
            == 401,
        )
        again = client.post(
            "/api/auth/login", json={"username": "checker", "password": "brand-new-pass"}
        )
        check("new password works", again.status_code == 200)
        check("key survives a password change", again.json()["apiKey"]["saved"])

        check(
            "signed out users cannot read conversations",
            (client.post("/api/auth/logout"), client.get("/api/threads").status_code)[1] == 401,
        )
    finally:
        main.stream_reply = original


def test_hosted_mode():
    print("hosted mode")
    from fastapi.testclient import TestClient

    from backend.limits import guard

    def fake_stream(history, attachments, api_key=None, system_extra="", provider_override="", model_override=""):
        yield "ok"

    original_stream = main.stream_reply
    original_provider = main.server_provider
    main.stream_reply = fake_stream
    # Pretend the operator has configured a shared key, without needing a real one.
    main.server_provider = lambda: {"provider": "openai", "key": "sk-shared", "model": "gpt-4o"}

    os.environ["LUNE_USER_DAILY_LIMIT"] = "2"
    os.environ["LUNE_INSTANCE_DAILY_LIMIT"] = "3"
    os.environ["LUNE_BURST_PER_MINUTE"] = "99"

    try:
        client = TestClient(main.app)
        client.post(
            "/api/auth/signup", json={"username": "hosted-a", "password": "hosted-pass"}
        )

        me = client.get("/api/me").json()
        check("shared key covers users with no key of their own", me["usingSharedKey"])
        check("allowance is reported", me["allowance"]["remaining"] == 2)

        send = lambda: client.post("/api/chat", data={"payload": json.dumps({"content": "hi"})})
        check("first metered message allowed", send().status_code == 200)
        check("second metered message allowed", send().status_code == 200)
        check("daily allowance enforced", send().status_code == 429)
        check(
            "allowance shown as spent",
            client.get("/api/me").json()["allowance"]["remaining"] == 0,
        )

        # A user's own key is their expense, so it must not be rationed.
        client.put("/api/account/key", json={"apiKey": "sk-personal-key-1234567890"})
        check("own key bypasses the allowance", send().status_code == 200)
        check(
            "own key is not metered",
            client.get("/api/me").json()["allowance"]["metered"] is False,
        )

        client.put("/api/account/key", json={"apiKey": ""})
        client.post("/api/auth/signup", json={"username": "hosted-b", "password": "hosted-pass"})
        check(
            "instance ceiling stops a second account too",
            (send(), send().status_code)[1] == 429,
            "global cap should bite after 3 total",
        )
    finally:
        main.stream_reply = original_stream
        main.server_provider = original_provider
        for name in (
            "LUNE_USER_DAILY_LIMIT",
            "LUNE_INSTANCE_DAILY_LIMIT",
            "LUNE_BURST_PER_MINUTE",
        ):
            os.environ.pop(name, None)


def test_sessions_and_signup_gate():
    print("sessions and signup")
    from fastapi.testclient import TestClient

    client = TestClient(main.app)
    client.post("/api/auth/signup", json={"username": "persist", "password": "persist-pass"})
    check("signed in after signup", client.get("/api/me").status_code == 200)

    # Simulate a process restart: the database keeps the session, memory does not.
    accounts.sessions._enc_keys.clear()
    check("session survives a restart", client.get("/api/me").status_code == 200)

    token = client.cookies.get(accounts.COOKIE_NAME)
    check("only a hash of the token is stored", store.load_session(token) is None)
    check(
        "the hashed token resolves",
        store.load_session(accounts.token_hash(token)) is not None,
    )

    os.environ["LUNE_INVITE_CODE"] = "brahms"
    try:
        fresh = TestClient(main.app)
        check(
            "signup refused without the invite code",
            fresh.post(
                "/api/auth/signup", json={"username": "nope", "password": "long-enough"}
            ).status_code
            == 403,
        )
        check(
            "signup accepted with the invite code",
            fresh.post(
                "/api/auth/signup",
                json={"username": "invited", "password": "long-enough", "inviteCode": "brahms"},
            ).status_code
            == 200,
        )
    finally:
        os.environ.pop("LUNE_INVITE_CODE", None)

    os.environ["LUNE_ALLOW_SIGNUP"] = "false"
    try:
        closed = TestClient(main.app)
        check(
            "signups can be closed entirely",
            closed.post(
                "/api/auth/signup", json={"username": "late", "password": "long-enough"}
            ).status_code
            == 403,
        )
        check("status advertises closed signups", not closed.get("/api/status").json()["signupsOpen"])
    finally:
        os.environ.pop("LUNE_ALLOW_SIGNUP", None)


def test_message_shaping():
    print("provider payloads")
    image = encode_image(b"fake", "image/jpeg")
    score = Attachment(kind="score", digest="Written key signature: G major")
    history = [
        {"role": "user", "content": "first"},
        {"role": "assistant", "content": "answer"},
        {"role": "user", "content": "second"},
    ]

    openai_messages = _openai_messages(history, [image, score])
    check("score data lands in the system prompt", "G major" in openai_messages[0]["content"])
    check("image attaches to the newest turn", isinstance(openai_messages[-1]["content"], list))
    check("older turns stay text only", isinstance(openai_messages[1]["content"], str))

    anthropic_messages = _anthropic_messages(history, [image, score])
    check(
        "anthropic image block well formed",
        anthropic_messages[-1]["content"][0]["source"]["media_type"] == "image/jpeg",
    )


if __name__ == "__main__":
    import shutil

    try:
        test_fingering()
        test_analysis()
        test_digest()
        test_preferences()
        test_accounts()
        test_transport()
        test_hosted_mode()
        test_sessions_and_signup_gate()
        test_message_shaping()
    finally:
        shutil.rmtree(_TEST_DATA_DIR, ignore_errors=True)

    print(f"\n{passed} passed, {failed} failed")
    raise SystemExit(1 if failed else 0)
