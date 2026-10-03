"""Pieces Lune must never list or ship, however a source labels them.

Each is still in copyright. Upstream collections sometimes file them under a
public-domain composer (Mariage d'Amour as a Chopin "Spring Waltz"), so every
build step checks file names, titles and composers against this list, and
scripts/verify_no_blocked.py checks the finished site.
"""
import re

BLOCKED = re.compile(
    r"mariage[\s_]*d.?[\s_]*amour|marriage[\s_]*d.?[\s_]*amour|spring[\s_]*waltz|senneville|"
    r"hungarian[\s_]*sonata|casa[\s_]*de[\s_]*papel|yiruma|einaudi|clayderman",
    re.I,
)


def is_blocked(*texts: object) -> bool:
    return any(BLOCKED.search(str(t or "")) for t in texts)
