"""Lune — a music-specialist AI assistant.

Wraps a vision-capable LLM with music-specific instructions, exact score data
from MusicXML analysis, and streaming responses.
"""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from typing import Any, Dict, Iterator, List, Optional

SYSTEM_PROMPT = """You are Lune, an AI assistant for musicians: a performer, theorist, and teacher
in one. You serve pianists, string players, singers, guitarists, composers, and students at every
level. You exist because general assistants are vague and unreliable on the things musicians
actually need, so your job is to be precise.

## Core competencies

1. NOTES AND LETTER NAMES
   - Give letter names with octave in scientific pitch notation (C4 = middle C).
   - Respect the key signature and any accidental earlier in the same bar.
   - Read treble, bass, alto, and tenor clefs, and say which clef you are reading.
   - For sight reading, lay a passage out bar by bar, beat by beat.

2. VOICE SEPARATION
   - Separate polyphony into independent lines: melody, inner voices, bass.
   - Use stem direction, rhythm, spacing, and voice-leading logic, not just pitch height.
   - Name subject, answer, countersubject, and episodes in fugal writing, with bar numbers.
   - Say which hand takes each voice and flag where a voice crosses hands.

3. FINGERING
   - Supply it: 1 = thumb through 5 = little finger.
   - Reason from hand span, thumb crossings, keeping the thumb off black keys, the following
     chord or leap, articulation, tempo, and preparing the next position.
   - Give a one-clause reason at tricky spots ("cross under here so 4 lands on the F#").
   - Offer an alternative when hand size or level would change the answer.
   - For strings give string, position, and shifts; for winds and voice give breaths.

4. DYNAMICS, ARTICULATION, INTERPRETATION
   - Explain a marking as it functions in this passage, not as a dictionary entry.
   - Tie dynamics to structure: sequence, cadence, harmonic tension, register, texture.
   - Respect period practice: Baroque terraced dynamics against Romantic swells, Beethoven's sf
     against Chopin's, the fortepiano's range against a modern grand.
   - Give a concrete plan with bar numbers: where to start, peak, and release.

5. THEORY AND ANALYSIS
   - Roman numerals, figured bass, chord symbols, modulation, cadence type, phrase structure,
     form, counterpoint. Be exact about inversions and non-chord tones.

6. PRACTICE AND TECHNIQUE
   - Drills tied to specific bars: hands separate, rhythmic variation, metronome targets, slow
     tempos, and a realistic timeline.
   - Diagnose tension, uneven passagework, and pedal blur, and prescribe fixes.

## Images of scores

- Say what you actually see: clefs, key signature, time signature, tempo and expression marks.
- Number bars from the first full bar unless a pickup is visible; state what you assumed.
- If a region is blurry, cropped, cut off at a system break, or ambiguous, SAY SO and name the
  bar or beat that is unclear. Never invent notes to fill a gap.
- If print or handwriting makes a pitch uncertain, give your best reading plus the alternative.
- Name the piece if you recognise it, with composer and period context.

## SCORE DATA blocks

When a SCORE DATA block appears below, it was produced by parsing the user's actual file. Treat it
as authoritative over any image and over your own recall, with three exceptions it labels itself:

- The written key signature is read from the file and is reliable. Any "algorithmically estimated
  key" is a statistical guess; use it only as a hint.
- Fingering in the block comes from a span-cost solver, not an edition. It is a reasonable
  starting point for average hands. Adapt it, and say when you are changing it and why.
- Roman numerals are only generated for real chords of three or more distinct pitches, so a
  monophonic or two-part texture will have no harmony line. Analyse it yourself in that case.

If the block says note-level detail was truncated, do not guess about the missing bars. Say what
you have and offer to look at a smaller excerpt.

## Accuracy

- Never fabricate a pitch, bar number, marking, or editorial detail. "I can't tell from this" is
  an acceptable answer; a confident wrong note is not.
- State your confidence when reading an image, or when the question is genuinely contested, as
  fingering and interpretation often are.
- Ask one focused clarifying question when the answer depends on instrument, level, edition, or
  hand size, but give a reasonable default answer first rather than stalling.

## Style

- Lead with the answer. Someone is sitting at an instrument waiting.
- Be brief by default: a few sentences or a short list. Expand only when asked, or when the
  question genuinely needs step-by-step detail.
- Use markdown sparingly. Reference bars constantly (m. 12, mm. 12-16).
- Format note lists to be scannable, e.g. `RH: G4 A4 B4 C5 - fingers 1 2 3 1`.
- No filler, no preamble, no restating the question, no emoji.
- Plain language for beginners, precise terminology for advanced players. Infer the level from
  how the question is asked.
"""

DEFAULT_MODEL_OPENAI = "gpt-4o"
DEFAULT_MODEL_ANTHROPIC = "claude-3-5-sonnet-latest"


@dataclass
class Attachment:
    """An uploaded file: a score image or parsed MusicXML."""

    kind: str  # "image" or "score"
    media_type: str = ""
    data_b64: str = ""
    digest: str = ""
    filename: str = ""


class LuneError(RuntimeError):
    pass


def _flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


def _model_for(provider: str, override: str = "") -> str:
    chosen = (override or "").strip() or os.environ.get("LUNE_MODEL", "").strip()
    if chosen:
        return chosen
    return DEFAULT_MODEL_OPENAI if provider == "openai" else DEFAULT_MODEL_ANTHROPIC


def server_provider() -> Optional[Dict[str, str]]:
    """The key configured on the server, if any. This takes precedence."""
    openai_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if openai_key:
        return {"provider": "openai", "key": openai_key, "model": _model_for("openai")}

    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if anthropic_key:
        return {
            "provider": "anthropic",
            "key": anthropic_key,
            "model": _model_for("anthropic"),
        }
    return None


def allow_user_keys() -> bool:
    return _flag("LUNE_ALLOW_USER_KEYS", True)


def resolve_provider(
    user_key: Optional[str] = None,
    provider_override: str = "",
    model_override: str = "",
) -> Dict[str, str]:
    """Work out which provider, key, and model to use for one request.

    The user's own key comes first: Lune is normally installed locally and each
    person pays their own provider. A server key is only consulted as a fallback
    for a shared deployment.
    """
    key = (user_key or "").strip()
    if key:
        provider = provider_override.strip() or (
            "anthropic" if key.startswith("sk-ant-") else "openai"
        )
        if provider not in ("openai", "anthropic"):
            provider = "anthropic" if key.startswith("sk-ant-") else "openai"
        return {
            "provider": provider,
            "key": key,
            "model": _model_for(provider, model_override),
        }

    server = server_provider()
    if server:
        if model_override.strip():
            server = dict(server)
            server["model"] = model_override.strip()
        return server

    raise LuneError(
        "No API key saved yet. Open Settings and paste an OpenAI or Anthropic key "
        "to start using Lune."
    )


def encode_image(raw: bytes, media_type: str) -> Attachment:
    return Attachment(
        kind="image",
        media_type=media_type or "image/png",
        data_b64=base64.b64encode(raw).decode("ascii"),
    )


def _score_context(attachments: List[Attachment]) -> str:
    blocks = [a.digest for a in attachments if a.kind == "score" and a.digest]
    if not blocks:
        return ""
    return (
        "\n\n## SCORE DATA (parsed from the uploaded file)\n\n" + "\n\n".join(blocks) + "\n"
    )


def _openai_messages(
    history: List[Dict[str, Any]],
    attachments: List[Attachment],
    system_extra: str = "",
) -> List[Dict[str, Any]]:
    messages: List[Dict[str, Any]] = [
        {
            "role": "system",
            "content": SYSTEM_PROMPT + system_extra + _score_context(attachments),
        }
    ]

    for index, turn in enumerate(history):
        is_last_user = index == len(history) - 1 and turn["role"] == "user"
        images = [a for a in attachments if a.kind == "image"] if is_last_user else []

        if not images:
            messages.append({"role": turn["role"], "content": turn["content"]})
            continue

        content: List[Dict[str, Any]] = [{"type": "text", "text": turn["content"]}]
        for image in images:
            content.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{image.media_type};base64,{image.data_b64}",
                        "detail": "high",
                    },
                }
            )
        messages.append({"role": turn["role"], "content": content})

    return messages


def _anthropic_messages(
    history: List[Dict[str, Any]],
    attachments: List[Attachment],
) -> List[Dict[str, Any]]:
    messages: List[Dict[str, Any]] = []

    for index, turn in enumerate(history):
        is_last_user = index == len(history) - 1 and turn["role"] == "user"
        images = [a for a in attachments if a.kind == "image"] if is_last_user else []

        if not images:
            messages.append({"role": turn["role"], "content": turn["content"]})
            continue

        content: List[Dict[str, Any]] = []
        for image in images:
            content.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": image.media_type,
                        "data": image.data_b64,
                    },
                }
            )
        content.append({"type": "text", "text": turn["content"]})
        messages.append({"role": turn["role"], "content": content})

    return messages


def stream_reply(
    history: List[Dict[str, Any]],
    attachments: Optional[List[Attachment]] = None,
    api_key: Optional[str] = None,
    system_extra: str = "",
    provider_override: str = "",
    model_override: str = "",
) -> Iterator[str]:
    """Yield response text chunks from the configured provider."""
    attachments = attachments or []
    config = resolve_provider(api_key, provider_override, model_override)

    if config["provider"] == "openai":
        yield from _stream_openai(history, attachments, config, system_extra)
    else:
        yield from _stream_anthropic(history, attachments, config, system_extra)


def _stream_openai(
    history: List[Dict[str, Any]],
    attachments: List[Attachment],
    config: Dict[str, str],
    system_extra: str = "",
) -> Iterator[str]:
    try:
        from openai import OpenAI
    except ImportError as exc:  # pragma: no cover
        raise LuneError("The openai package is missing. Run: pip install -r requirements.txt") from exc

    client = OpenAI(api_key=config["key"])
    stream = client.chat.completions.create(
        model=config["model"],
        messages=_openai_messages(history, attachments, system_extra),
        temperature=0.4,
        max_tokens=2000,
        stream=True,
    )

    for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        if delta and delta.content:
            yield delta.content


def _stream_anthropic(
    history: List[Dict[str, Any]],
    attachments: List[Attachment],
    config: Dict[str, str],
    system_extra: str = "",
) -> Iterator[str]:
    try:
        from anthropic import Anthropic
    except ImportError as exc:  # pragma: no cover
        raise LuneError("The anthropic package is missing. Run: pip install -r requirements.txt") from exc

    client = Anthropic(api_key=config["key"])
    with client.messages.stream(
        model=config["model"],
        max_tokens=2000,
        temperature=0.4,
        system=SYSTEM_PROMPT + system_extra + _score_context(attachments),
        messages=_anthropic_messages(history, attachments),
    ) as stream:
        for text in stream.text_stream:
            yield text


def sse(event: str, payload: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


def friendly_error(exc: Exception) -> str:
    """Translate provider errors into something a musician can act on."""
    text = str(exc).lower()

    if "insufficient_quota" in text or "exceeded your current quota" in text:
        return (
            "The API account has no credit left. Add a payment method and buy credits at "
            "platform.openai.com/settings/organization/billing, then try again. "
            "The key itself is working."
        )
    if "invalid_api_key" in text or "incorrect api key" in text or "401" in text:
        return (
            "The API key was rejected. Check for a typo or a missing character, or "
            "create a fresh key and save it again in Settings."
        )
    if "model_not_found" in text or "does not exist" in text:
        return (
            "This account cannot use the chosen model. Pick a different model in "
            "Settings, or leave the model field blank to use the default."
        )
    if "rate_limit" in text or "429" in text:
        return "The provider is rate limiting requests. Wait a few seconds and try again."
    if "connection" in text or "timeout" in text:
        return "Could not reach the model provider. Check your internet connection."

    return f"{type(exc).__name__}: {exc}"
