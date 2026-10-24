"""High quality 82M-param TTS https://github.com/hexgrad/kokoro."""
from __future__ import annotations

import importlib.util
import threading

from .base import TTSEngine, Voice

# Kokoro voice ids encode language (1st letter) and gender (2nd letter).
VOICES = [
    "af_heart", "af_bella", "af_nicole", "af_sky", "af_nova", "am_adam", "am_michael",
    "am_fenrir", "am_puck", "bf_emma", "bf_isabella", "bm_george", "bm_lewis",
    "ef_dora", "em_alex", "ff_siwis", "hf_alpha", "hm_omega", "if_sara", "im_nicola",
    "jf_alpha", "jm_kumo", "pf_dora", "pm_alex", "zf_xiaobei", "zm_yunjian",
]
LANGS = {"a": "en-US", "b": "en-GB", "e": "es", "f": "fr", "h": "hi",
         "i": "it", "j": "ja", "p": "pt-BR", "z": "zh"}


class KokoroTTS(TTSEngine):
    id = "kokoro"
    name = "Kokoro"
    repo = "hexgrad/kokoro"
    description = "Model 82M tham số, chất lượng rất cao, offline. Anh, Tây Ban Nha, Pháp, Nhật, Trung..."
    install_hint = "pip install kokoro soundfile  (cần espeak-ng)"

    def __init__(self):
        self._pipelines = {}
        self._lock = threading.Lock()

    def available(self) -> bool:
        return importlib.util.find_spec("kokoro") is not None

    def list_voices(self) -> list[Voice]:
        return [
            Voice(id=v, name=v[3:].capitalize(), lang=LANGS[v[0]],
                  gender="female" if v[1] == "f" else "male", engine=self.id, tags=["offline"])
            for v in VOICES
        ]

    def synthesize(self, text, voice_id, out_path, *, lang=None, ref_audio=None):
        import numpy as np
        import soundfile as sf
        from kokoro import KPipeline

        code = voice_id[0]
        with self._lock:
            if code not in self._pipelines:
                self._pipelines[code] = KPipeline(lang_code=code)
            pipe = self._pipelines[code]
            chunks = [audio for _, _, audio in pipe(text, voice=voice_id)]
        out_path = out_path.rsplit(".", 1)[0] + ".wav"
        sf.write(out_path, np.concatenate(chunks) if chunks else np.zeros(2400), 24000)
        return out_path
