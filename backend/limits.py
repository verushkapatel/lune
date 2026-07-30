"""Spend protection for hosted mode.

When Lune runs as a hosted service the operator's own API key pays for every
message, so the limits here are the only thing between a stranger and that bill.

Two layers, both counted in the database rather than in process memory so they
survive restarts and apply across worker processes:

  * a per-account daily allowance, and
  * a whole-instance daily ceiling that acts as a circuit breaker.

Requests that spend a user's own key are never counted, because they cost the
operator nothing.
"""

from __future__ import annotations

import os
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Optional, Tuple

from backend import store

BURST_WINDOW_SECONDS = 60


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default


class SpendGuard:
    def __init__(self) -> None:
        # Short-window burst control stays in memory: it only needs to blunt
        # rapid-fire requests, and the daily caps below are the real ceiling.
        self._burst: Dict[int, Deque[float]] = defaultdict(deque)

    @property
    def per_user_daily(self) -> int:
        return _int_env("LUNE_USER_DAILY_LIMIT", 40)

    @property
    def instance_daily(self) -> int:
        return _int_env("LUNE_INSTANCE_DAILY_LIMIT", 400)

    @property
    def per_minute(self) -> int:
        return _int_env("LUNE_BURST_PER_MINUTE", 6)

    def remaining(self, user_id: int) -> int:
        return max(0, self.per_user_daily - store.usage_today(user_id))

    def check(self, user_id: int) -> Tuple[bool, Optional[str]]:
        """Return (allowed, message). Does not record; call record() on success."""
        now = time.time()
        recent = self._burst[user_id]
        while recent and now - recent[0] > BURST_WINDOW_SECONDS:
            recent.popleft()

        if len(recent) >= self.per_minute:
            return False, "You're sending messages very quickly. Wait a moment and try again."

        if store.usage_today(user_id) >= self.per_user_daily:
            return False, (
                f"You've used your {self.per_user_daily} messages for today. "
                "Your allowance resets at midnight UTC, or you can add your own "
                "API key in Settings for unlimited use."
            )

        if store.global_usage_today() >= self.instance_daily:
            return False, (
                "Lune has hit its daily limit across all users. Please try again "
                "tomorrow, or add your own API key in Settings to keep going."
            )

        return True, None

    def record(self, user_id: int) -> None:
        self._burst[user_id].append(time.time())
        store.record_usage(user_id)


guard = SpendGuard()
