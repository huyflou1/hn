"""Meta MMS-TTS (https://github.com/facebookresearch/fairseq/tree/main/examples/mms) via Hugging Face transformers."""
from __future__ import annotations

import importlib.util
import threading

from .base import TTSEngine, Voice

MODELS = {  # voice id -> (model, lang, display name)
    "vie": ("facebook/mms-tts-vie", "vi-VN", "MMS Tiếng Việt"),
    "eng": ("facebook/mms-tts-eng", "en", "MMS English"),
    "fra": ("facebook/mms-tts-fra", "fr", "MMS Français"),
    "spa": ("facebook/mms-tts-spa", "es", "MMS Español"),
    "kor": ("facebook/mms-tts-kor", "ko", "MMS 한국어"),
    "tha": ("facebook/mms-tts-tha", "th", "MMS ไทย"),
    "ind": ("facebook/mms-tts-ind", "id", "MMS Indonesia"),
}


class MmsTTS(TTSEngine):
    id = "mms"
    name = "Meta MMS"
    repo = "facebookresearch/fairseq"
    description = "Model TTS đa ngôn ngữ của Meta, chạy offline, có tiếng Việt. Tải model (~150MB) lần đầu dùng."
    install_hint = "pip install transformers torch soundfile"

    def __init__(self):
        self._models = {}
        self._lock = threading.Lock()

    def available(self) -> bool:
        return all(importlib.util.find_spec(m) is not None for m in ("transformers", "torch", "soundfile"))

    def list_voices(self) -> list[Voice]:
        return [Voice(id=k, name=name, lang=lang, engine=self.id, tags=["offline"])
                for k, (_, lang, name) in MODELS.items()]

    def synthesize(self, text, voice_id, out_path, *, lang=None, ref_audio=None):
        import soundfile as sf
        import torch
        from transformers import AutoTokenizer, VitsModel

        repo = MODELS[voice_id][0]
        with self._lock:
            if repo not in self._models:
                self._models[repo] = (VitsModel.from_pretrained(repo), AutoTokenizer.from_pretrained(repo))
            model, tok = self._models[repo]
            inputs = tok(text.lower(), return_tensors="pt")
            with torch.no_grad():
                wave = model(**inputs).waveform[0].numpy()
        out_path = out_path.rsplit(".", 1)[0] + ".wav"
        sf.write(out_path, wave, model.config.sampling_rate)
        return out_path
