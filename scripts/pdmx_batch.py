#!/usr/bin/env python3
"""Convert the PDMX solo-piano candidates in parallel (scripts/pdmx_convert.py).

Usage: python3 scripts/pdmx_batch.py <pdmx-root> <cands.txt> <out-dir> <results.jsonl>
Each line of results.jsonl: {"src", "id", "file", "ok", "bars", "notes", "bytes"} or an error.
A piece that cannot be written faithfully is skipped, never guessed at.
"""
import json
import os
import signal
import sys
from multiprocessing import Pool

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
ROOT, CANDS, OUT, RES = sys.argv[1:5]


def ident(src):
    h = os.path.basename(src).split(".")[0]
    return "pdmx-" + h[2:14]


def work(src):
    import pdmx_convert as P

    pid = ident(src)
    rel = f"{pid[5:7].lower()}/{pid}.mxl"
    dst = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)

    def alarm(*_):
        raise TimeoutError("too slow")

    signal.signal(signal.SIGALRM, alarm)
    signal.alarm(40)
    try:
        info = P.convert(os.path.join(ROOT, src), dst)
        signal.alarm(0)
        return {"src": src, "id": pid, "file": rel, "ok": True, **info, "bytes": os.path.getsize(dst)}
    except BaseException as e:  # noqa: BLE001
        signal.alarm(0)
        try:
            os.remove(dst)
        except OSError:
            pass
        return {"src": src, "id": pid, "ok": False, "err": f"{type(e).__name__}: {str(e)[:120]}"}


if __name__ == "__main__":
    srcs = [l.strip() for l in open(CANDS) if l.strip()]
    done = set()
    if os.path.exists(RES):
        for l in open(RES):
            try:
                done.add(json.loads(l)["src"])
            except Exception:
                pass
    todo = [s for s in srcs if s not in done]
    print(f"{len(todo)} to convert ({len(done)} already done)", flush=True)
    with open(RES, "a") as out, Pool(4, maxtasksperchild=400) as pool:
        for i, r in enumerate(pool.imap_unordered(work, todo, chunksize=8)):
            out.write(json.dumps(r) + "\n")
            if i % 500 == 0:
                out.flush()
                print(i, flush=True)
