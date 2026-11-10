"""Participant codes for the Lune reading study, balanced across conditions.

Lune assigns the condition from the code itself (FNV-1a hash, even = labels,
odd = no-labels — the same function as frontend/study.js), so the teacher
hands out codes and nobody chooses who gets which condition.

    python3 scripts/study_codes.py 24 > codes.csv     # 12 + 12, shuffled

Keep the CSV private (it is the only link between a code and a condition
until analysis); never write names into it.
"""
import random
import secrets
import sys

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I


def fnv(s: str) -> int:
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def condition(code: str) -> str:
    return "labels" if fnv(code.upper()) % 2 == 0 else "no-labels"


def make(n: int):
    want = {"labels": n // 2 + n % 2, "no-labels": n // 2}
    codes = []
    while want["labels"] or want["no-labels"]:
        code = "".join(secrets.choice(ALPHABET) for _ in range(2)) + "-" + "".join(secrets.choice(ALPHABET) for _ in range(3))
        c = condition(code)
        if want[c] and code not in [x for x, _ in codes]:
            want[c] -= 1
            codes.append((code, c))
    random.SystemRandom().shuffle(codes)
    return codes


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 24
    print("code,condition")
    for code, c in make(n):
        print(f"{code},{c}")
