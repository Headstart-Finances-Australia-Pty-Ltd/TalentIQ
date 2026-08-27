"""
TalentIQ — text-to-speech for interview questions.

Two natural-voice engines are supported, chosen by the admin in Settings >
Admin Console (service='interview', key='tts_engine'):

  * "kokoro" — Kokoro-82M (https://github.com/thewh1teagle/kokoro-onnx), an
    open-weight model that runs entirely on this server (no external calls
    per-question once its ~120MB of weights are cached locally). Best when
    outbound access to Microsoft's speech service is restricted, or for a
    fully self-hosted setup.
  * "edge" — Microsoft Edge's online neural voices via the `edge-tts`
    library. No model download or native dependencies (no espeak-ng) —
    just a network call per question to a free, unauthenticated Microsoft
    endpoint. Good fallback when Kokoro's model files can't be downloaded
    or its native espeak-ng dependency isn't available in this environment.
  * "browser" — turns server-side TTS off entirely; the frontend falls
    back to the browser's own (more mechanical-sounding) SpeechSynthesis
    voice, which always works with zero setup.

Every call site treats a None/failed result as "fall back one level" —
kokoro failing falls back to whatever the browser provides, same for edge
— so an interview is never blocked on TTS.
"""
import asyncio
import logging
import os
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

MODEL_DIR = Path(os.getenv("KOKORO_MODEL_DIR", Path(__file__).resolve().parent.parent / "data" / "kokoro"))
MODEL_PATH = MODEL_DIR / "kokoro-v1.0.int8.onnx"
VOICES_PATH = MODEL_DIR / "voices-v1.0.bin"

# The smaller int8-quantized model (~92MB) — a few % less crisp than the
# full fp32 model (~325MB) but effectively indistinguishable for a single
# spoken interview question, and a much lighter first-run download.
MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx"
VOICES_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"

# Voices an admin can choose from in Settings > Admin Console. Kokoro ships
# many more (see the project's VOICES.md) — this is a curated shortlist of
# the clearest English voices for a professional interview context.
AVAILABLE_VOICES = {
    "af_heart":  "Heart (US English, female) — warm, default",
    "af_bella":  "Bella (US English, female)",
    "af_nicole": "Nicole (US English, female)",
    "am_adam":   "Adam (US English, male)",
    "am_michael": "Michael (US English, male)",
    "bf_emma":   "Emma (British English, female)",
    "bm_george": "George (British English, male)",
}
DEFAULT_VOICE = "af_heart"

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

_kokoro_instance = None
_load_attempted = False
_load_error: Optional[str] = None


def _download(url: str, dest: Path) -> None:
    import requests
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with requests.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 20):
                if chunk:
                    f.write(chunk)
    tmp.rename(dest)


def _load_kokoro():
    """Synchronous load — downloads model files on first call if missing,
    then constructs the Kokoro engine. Cached in _kokoro_instance for
    every call after the first. Never raises; sets _load_error instead."""
    global _kokoro_instance, _load_attempted, _load_error
    if _kokoro_instance is not None or _load_attempted:
        return _kokoro_instance
    _load_attempted = True
    try:
        import espeakng_loader
        from phonemizer.backend.espeak.wrapper import EspeakWrapper
        EspeakWrapper.set_library(espeakng_loader.get_library_path())

        from kokoro_onnx import Kokoro

        if not MODEL_PATH.exists():
            logger.info("Kokoro model not found locally — downloading (~92MB, one-time)…")
            _download(MODEL_URL, MODEL_PATH)
        if not VOICES_PATH.exists():
            logger.info("Kokoro voices file not found locally — downloading (~28MB, one-time)…")
            _download(VOICES_URL, VOICES_PATH)

        _kokoro_instance = Kokoro(str(MODEL_PATH), str(VOICES_PATH))
        logger.info("Kokoro-82M TTS loaded successfully from %s", MODEL_DIR)
    except Exception as e:
        _load_error = str(e)
        _kokoro_instance = None
        logger.warning("Kokoro TTS unavailable, falling back to browser voice: %s", e)
    return _kokoro_instance


async def synthesize_speech(text: str, voice: str = DEFAULT_VOICE, speed: float = 1.0) -> Optional[bytes]:
    """Returns WAV audio bytes for `text` spoken in `voice`, or None if
    Kokoro isn't available (caller should fall back to the browser's
    speechSynthesis in that case — see the /tts endpoints in joblens.py)."""
    if not text or not text.strip():
        return None
    if voice not in AVAILABLE_VOICES:
        voice = DEFAULT_VOICE

    def _run() -> Optional[bytes]:
        kokoro = _load_kokoro()
        if kokoro is None:
            return None
        import io
        import soundfile as sf
        samples, sample_rate = kokoro.create(text, voice=voice, speed=speed, lang="en-us")
        buf = io.BytesIO()
        sf.write(buf, samples, sample_rate, format="WAV")
        return buf.getvalue()

    # kokoro-onnx's create() is CPU-bound and synchronous — run it off the
    # event loop so one candidate's TTS call doesn't stall every other
    # request the server is handling at the same time.
    return await asyncio.get_event_loop().run_in_executor(None, _run)


def kokoro_unavailable_reason() -> Optional[str]:
    """None if Kokoro loaded fine (or hasn't been tried yet); otherwise the
    reason the last load attempt failed, for surfacing in Settings."""
    return _load_error


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
    if engine == "edge":
        audio = await synthesize_speech_edge(text, voice=voice)
        return audio, "audio/mpeg"
    # default: kokoro
    audio = await synthesize_speech(text, voice=voice)
    return audio, "audio/wav"
