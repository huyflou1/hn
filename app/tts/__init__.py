"""Registry of every TTS engine. Engines whose package isn't installed are listed as unavailable."""
from .base import TTSEngine, Voice, lang_base
from .edge import EdgeTTS
from .espeak import EspeakTTS
from .fpt import FptTTS
from .gtts_engine import GoogleTTS
from .kokoro_engine import KokoroTTS
from .mms import MmsTTS
from .piper_engine import PiperTTS
from .xtts import XTTS

ENGINES: dict[str, TTSEngine] = {e.id: e for e in (
    EdgeTTS(), PiperTTS(), FptTTS(), GoogleTTS(), MmsTTS(), KokoroTTS(), XTTS(), EspeakTTS(),
)}


def get_engine(engine_id: str) -> TTSEngine:
    try:
        return ENGINES[engine_id]
    except KeyError:
        raise KeyError(f"Engine không tồn tại: {engine_id}") from None


__all__ = ["ENGINES", "TTSEngine", "Voice", "get_engine", "lang_base"]
