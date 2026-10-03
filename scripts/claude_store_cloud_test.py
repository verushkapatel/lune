"""LuneStore against a real PostgREST + PostgreSQL running supabase/schema.sql.

Exercises the signed-in code paths of frontend/store.js through supabase-js
(the library the site uses), as two different users, and checks that each
only ever sees their own rows. Storage (uploads) and the email sign-in itself
are Supabase services not reproduced here.

Needs: PostgREST on :3901 with jwt-secret below, a proxy serving it at
http://127.0.0.1:3902/rest/v1, and the static site on :8100.
"""
import base64
import hashlib
import hmac
import json
import sys
import time

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8100/lune/"
SECRET = b"lune-test-secret-lune-test-secret-0123"
A = "11111111-1111-1111-1111-111111111111"
B = "22222222-2222-2222-2222-222222222222"


def jwt(claims):
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(",", ":")).encode()).rstrip(b"=")  # noqa: E731
    head = enc({"alg": "HS256", "typ": "JWT"}) + b"." + enc({**claims, "exp": int(time.time()) + 3600})
    sig = base64.urlsafe_b64encode(hmac.new(SECRET, head, hashlib.sha256).digest()).rstrip(b"=")
    return (head + b"." + sig).decode()


ANON = jwt({"role": "anon"})
out = []


def check(name, ok, detail=""):
    out.append(("PASS" if ok else "FAIL", name, str(detail)[:240]))


ATTACH = """async ([anon, token, uid, email]) => {
  if (!window.supabase) await new Promise((res) => { const s = document.createElement('script'); s.src = 'static/vendor/supabase.js'; s.onload = res; document.head.appendChild(s); });
  const c = supabase.createClient('http://127.0.0.1:3902', anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: 'Bearer ' + token } } });
  LuneStore.__attach(c, { user: { id: uid, email } });
  return LuneStore.status();
}"""

with sync_playwright() as p:
    br = p.chromium.launch()
    pa = br.new_page()
    errs = []
    pa.on("pageerror", lambda e: errs.append(str(e)))
    pa.goto(BASE, wait_until="networkidle")
    st = pa.evaluate(ATTACH, [ANON, jwt({"role": "authenticated", "sub": A}), A, "a@x.org"])
    check("signed in as A", st["signedIn"] and st["email"] == "a@x.org", st)

    r = pa.evaluate(
        """async () => {
      const S = LuneStore, out = {};
      await S.addPiece({ piece_key: 'beethoven-fur-elise', title: 'Für Elise', composer: 'Beethoven' });
      await S.addPiece({ piece_key: 'beethoven-fur-elise', title: 'Für Elise', composer: 'Beethoven' }); // upsert, no duplicate
      await S.addPiece({ piece_key: 'satie-gymnopedie-1', title: 'Gymnopédie No. 1', composer: 'Satie' });
      out.pieces = (await S.listPieces()).map(p => p.piece_key).sort();
      await S.updatePiece('satie-gymnopedie-1', { status: 'polishing' });
      out.status = (await S.getPiece('satie-gymnopedie-1')).status;
      const n = await S.addNote({ pieceKey: 'beethoven-fur-elise', bar: 12, body: 'play faster here', tags: ['tempo'], source: 'voice' });
      await S.addNote({ pieceKey: 'beethoven-fur-elise', bar: 13, body: 'thumb under', tags: ['fingering'] });
      out.notes = (await S.listNotes('beethoven-fur-elise')).map(x => x.bar + ':' + x.body + ':' + x.source);
      out.counts = await S.countNotesByPiece();
      await S.deleteNote(n.id);
      out.notesAfterDelete = (await S.listNotes('beethoven-fur-elise')).length;
      await S.reviewBar('beethoven-fur-elise', 12, 'good');
      await S.reviewBar('beethoven-fur-elise', 12, 'good');  // upsert on (user, piece, bar)
      await S.queueBar('beethoven-fur-elise', 30);
      const cards = await S.listCards('beethoven-fur-elise');
      out.cards = cards.map(c => c.bar + ':' + c.reps + ':' + c.interval_days);
      out.due = (await S.dueCards()).map(c => c.bar);
      out.practised = !!(await S.getPiece('beethoven-fur-elise')).last_practised_at;
      await S.addStumbles('beethoven-fur-elise', { 4: { wrong: 2, hesitations: 1 }, 5: { wrong: 0, hesitations: 0 } });
      out.map = await S.stumbleMap('beethoven-fur-elise');
      out.study = await S.addStudyRows([{ study: 'labels-v1', participant: 'T-01', phase: 'pre', condition: 'labels', item: 0, answer: 'C', correct: true, ms: 900 }]);
      try { await S.addStudyRows([{ study: 'labels-v1', participant: 'Jane Smith', phase: 'pre', condition: 'labels', item: 0, answer: 'C', correct: true, ms: 900 }]); out.nameRow = 'stored?'; } catch (e) { out.nameRow = 'error'; }
      out.exported = Object.keys(await S.exportAll());
      return out;
    }"""
    )
    check("repertoire: add + upsert without duplicates", r["pieces"] == ["beethoven-fur-elise", "satie-gymnopedie-1"], r["pieces"])
    check("repertoire: status update", r["status"] == "polishing", r["status"])
    check("notes: add, list (with source), count", len(r["notes"]) == 2 and "12:play faster here:voice" in r["notes"] and r["counts"].get("beethoven-fur-elise") == 2, r)
    check("notes: delete", r["notesAfterDelete"] == 1, r["notesAfterDelete"])
    check("review: graded card upserts (reps 2, 3 days)", "12:2:3" in r["cards"], r["cards"])
    check("review: queued bar due now, graded bar not", r["due"] == [30], r["due"])
    check("review: marks piece practised", r["practised"])
    check("stumbles: stored, zero rows skipped, mapped", r["map"].get("4", {}).get("wrong") == 2 and "5" not in r["map"], r["map"])
    check("study: anonymous row goes to the cloud table", r["study"] == "cloud", r["study"])
    check("export: includes everything", set(["repertoire", "bar_notes", "bar_cards"]) <= set(r["exported"]), r["exported"])

    # --- user B sees nothing of A's, can't change it ---
    pb = br.new_page()
    pb.goto(BASE, wait_until="networkidle")
    pb.evaluate(ATTACH, [ANON, jwt({"role": "authenticated", "sub": B}), B, "b@x.org"])
    rb = pb.evaluate(
        """async () => {
      const S = LuneStore;
      const seen = { pieces: (await S.listPieces()).length, notes: (await S.listNotes('beethoven-fur-elise')).length, cards: (await S.listCards()).length, map: Object.keys(await S.stumbleMap('beethoven-fur-elise')).length };
      await S.updatePiece('satie-gymnopedie-1', { status: 'ready' });  // A's row: must not change
      await S.removePiece('beethoven-fur-elise');
      await S.addPiece({ piece_key: 'beethoven-fur-elise', title: 'Für Elise (B)' });
      seen.own = (await S.listPieces()).map(p => p.title);
      return seen;
    }"""
    )
    check("isolation: B sees none of A's pieces, notes, cards, stumbles", rb["pieces"] == 0 and rb["notes"] == 0 and rb["cards"] == 0 and rb["map"] == 0, rb)
    check("isolation: B can have the same piece key separately", rb["own"] == ["Für Elise (B)"], rb["own"])
    ra = pa.evaluate("async () => ({ status: (await LuneStore.getPiece('satie-gymnopedie-1')).status, elise: (await LuneStore.getPiece('beethoven-fur-elise'))?.title })")
    check("isolation: B's update/delete didn't touch A's rows", ra == {"status": "polishing", "elise": "Für Elise"}, ra)

    # --- moving browser data into the account ---
    pc = br.new_page()
    pc.goto(BASE, wait_until="networkidle")
    pc.evaluate("async () => { await LuneStore.addPiece({ piece_key: 'twinkle', title: 'Twinkle' }); await LuneStore.addNote({ pieceKey: 'twinkle', bar: 2, body: 'gentle' }); await LuneStore.queueBar('twinkle', 3); }")
    pc.evaluate(ATTACH, [ANON, jwt({"role": "authenticated", "sub": B}), B, "b@x.org"])
    mv = pc.evaluate("async () => { const n = await LuneStore.importLocalIntoAccount(); return { n, local: LuneStore.hasLocalData(), pieces: (await LuneStore.listPieces()).map(p => p.piece_key).sort(), notes: (await LuneStore.listNotes('twinkle')).length, cards: (await LuneStore.listCards('twinkle')).length }; }")
    check("sign-in: browser data moves into the account", mv["n"] == 3 and not mv["local"] and "twinkle" in mv["pieces"] and mv["notes"] == 1 and mv["cards"] == 1, mv)

    # --- anonymous visitor can't read anything ---
    pd = br.new_page()
    pd.goto(BASE, wait_until="networkidle")
    anon_rows = pd.evaluate(
        """async ([anon]) => { await new Promise((res) => { const s = document.createElement('script'); s.src = 'static/vendor/supabase.js'; s.onload = res; document.head.appendChild(s); });
        const c = supabase.createClient('http://127.0.0.1:3902', anon, { auth: { persistSession: false } });
        const out = {};
        for (const t of ['repertoire', 'bar_notes', 'bar_cards', 'stumbles', 'study_results']) { const { data, error } = await c.from(t).select('*'); out[t] = error ? 'denied' : data.length; }
        return out; }""",
        [ANON],
    )
    check("anonymous: reads nothing from any table", all(v in (0, "denied") for v in anon_rows.values()), anon_rows)

    # --- delete account ---
    gone = pa.evaluate("async () => { await LuneStore.deleteAccount().catch(e => e.message); return LuneStore.status().signedIn; }")
    check("delete account: signs out", gone is False, gone)
    check("no page errors", not errs, errs[:2])
    br.close()

import subprocess  # noqa: E402

left = subprocess.run(
    ["su", "postgres", "-c", f"psql -h /tmp/pgt -p 5499 -d lunerest -tA -c \"select (select count(*) from repertoire where user_id='{A}'), (select count(*) from bar_notes where user_id='{A}'), (select count(*) from auth.users where id='{A}'), (select count(*) from study_results)\""],
    capture_output=True, text=True,
).stdout.strip()
check("delete account: A's rows and user gone, study rows kept", left == "0|0|0|1", left)

w = max(len(n) for _, n, _ in out)
for s, n, d in out:
    print(f"{s}  {n.ljust(w)}  {d if s == 'FAIL' else ''}")
print(f"\n{sum(s == 'PASS' for s, _, _ in out)}/{len(out)} passed")
