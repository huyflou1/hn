"""Voice cloning with XTTS-v2 from https://github.com/idiap/coqui-ai-TTS (maintained Coqui TTS fork)."""
from __future__ import annotations

import importlib.util
import threading

from .base import TTSEngine, Voice, lang_base

MODEL = "tts_models/multilingual/multi-dataset/xtts_v2"
XTTS_LANGS = {"en", "es", "fr", "de", "it", "pt", "pl", "tr", "ru", "nl", "cs",
              "ar", "zh-cn", "ja", "hu", "ko", "hi"}
BUILTIN = ["Claribel Dervla", "Daisy Studious", "Gracie Wise", "Ana Florence",
           "Andrew Chipper", "Craig Gutsy", "Damien Black", "Viktor Eka"]


class XTTS(TTSEngine):
    id = "xtts"
    name = "Coqui XTTS (nhân bản giọng)"
    repo = "idiap/coqui-ai-TTS"
    description = "Nhân bản giọng nói gốc trong video và đọc lại theo phụ đề. Nên dùng GPU."
    install_hint = "pip install coqui-tts"

    def __init__(self):
        self._tts = None
        self._lock = threading.Lock()

    def available(self) -> bool:
        return importlib.util.find_spec("TTS") is not None

    def list_voices(self) -> list[Voice]:
        voices = [Voice(id="clone:original", name="Giọng gốc trong video", lang="*",
                        engine=self.id, tags=["clone"])]
        voices += [Voice(id=f"speaker:{s}", name=s, lang="*", engine=self.id) for s in BUILTIN]
        return voices

    def synthesize(self, text, voice_id, out_path, *, lang=None, ref_audio=None):
        with self._lock:
            if self._tts is None:
                import torch
                from TTS.api import TTS

                self._tts = TTS(MODEL).to("cuda" if torch.cuda.is_available() else "cpu")
            code = (lang or "en").lower()
            code = code if code in XTTS_LANGS else lang_base(code)
            if code == "zh":
                code = "zh-cn"
            if code not in XTTS_LANGS:
                code = "en"
            out_path = out_path.rsplit(".", 1)[0] + ".wav"
            kwargs = {"text": text, "language": code, "file_path": out_path}
            if voice_id.startswith("clone:"):
                if not ref_audio:
                    raise ValueError("Không có mẫu giọng gốc để nhân bản")
                kwargs["speaker_wav"] = ref_audio
            else:
                kwargs["speaker"] = voice_id.split(":", 1)[1]
            self._tts.tts_to_file(**kwargs)
        return out_path
