"""
TalentIQ — text-to-speech for interview questions.

One natural-voice engine is supported, chosen by the admin in Settings >
Admin Console (service='interview', key='tts_engine'):

  * "edge" — Microsoft Edge's online neural voices via the `edge-tts`
    library. No model download or native dependencies — just a network
    call per question to a free, unauthenticated Microsoft endpoint.
    Default and first-choice engine.
  * "browser" — turns server-side TTS off entirely; the frontend falls
    back to the browser's own (more mechanical-sounding) SpeechSynthesis
    voice, which always works with zero setup.

Every call site treats a None/failed result as "fall back one level" —
edge failing falls back to whatever the browser provides — so an
interview is never blocked on TTS.
"""
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Microsoft Edge neural voices — curated shortlist of clear, professional
# English voices. No model download: edge-tts calls Microsoft's free
# speech endpoint per request. Full list: `edge-tts --list-voices`.
EDGE_VOICES = {
    "en-US-AriaNeural":   "Aria (US English, female)",
    "en-US-JennyNeural":  "Jenny (US English, female) — warm, default",
    "en-US-GuyNeural":    "Guy (US English, male)",
    "en-US-DavisNeural":  "Davis (US English, male)",
    "en-GB-SoniaNeural":  "Sonia (British English, female)",
    "en-GB-RyanNeural":   "Ryan (British English, male)",
    "en-AU-NatashaNeural": "Natasha (Australian English, female)",
    "en-IN-NeerjaNeural": "Neerja (Indian English, female)",
}
DEFAULT_EDGE_VOICE = "en-US-JennyNeural"


async def synthesize_speech_edge(text: str, voice: str = DEFAULT_EDGE_VOICE) -> Optional[bytes]:
    """Returns MP3 audio bytes for `text` spoken by a Microsoft Edge neural
    voice, or None on any failure (network blocked, service unreachable,
    invalid voice, etc.) — caller falls back to the browser voice."""
    if not text or not text.strip():
        return None
    if voice not in EDGE_VOICES:
        voice = DEFAULT_EDGE_VOICE
    try:
        import edge_tts
        communicate = edge_tts.Communicate(text, voice=voice)
        chunks = []
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                chunks.append(chunk["data"])
        audio = b"".join(chunks)
        return audio or None
    except Exception as e:
        logger.warning("edge-tts unavailable, falling back to browser voice: %s", e)
        return None


async def synthesize(text: str, engine: str, voice: str) -> tuple[Optional[bytes], str]:
    """Single entry point used by joblens.py's /tts endpoints — routes to
    whichever engine the admin configured. Returns (audio_bytes_or_None,
    media_type). audio_bytes is None if that engine failed/is unavailable,
    in which case the caller returns a 503 and the frontend falls back to
    the browser's own voice."""
    # default / first-choice: edge
    audio = await synthesize_speech_edge(text, voice=voice)
    return audio, "audio/mpeg"
