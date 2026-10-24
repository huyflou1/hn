"""Google Translate TTS via https://github.com/pndurette/gTTS."""
from __future__ import annotations

import importlib.util
from functools import lru_cache

from .base import TTSEngine, Voice

# Regional accents gTTS exposes through different Google domains.
ACCENTS = {
    "en": [("com", "Mỹ"), ("co.uk", "Anh"), ("com.au", "Úc"), ("ca", "Canada"),
           ("co.in", "Ấn Độ"), ("ie", "Ireland"), ("co.za", "Nam Phi")],
    "fr": [("fr", "Pháp"), ("ca", "Canada")],
    "pt": [("com.br", "Brazil"), ("pt", "Bồ Đào Nha")],
    "es": [("es", "Tây Ban Nha"), ("com.mx", "Mexico")],
}


class GoogleTTS(TTSEngine):
    id = "gtts"
    name = "Google TTS"
    repo = "pndurette/gTTS"
    description = "Giọng Google Dịch, hỗ trợ rất nhiều ngôn ngữ và một số giọng vùng miền."
    install_hint = "pip install gTTS"
    needs_network = True

    def available(self) -> bool:
        return importlib.util.find_spec("gtts") is not None

    @lru_cache(maxsize=1)
    def list_voices(self) -> list[Voice]:
        from gtts.lang import tts_langs

        voices = []
        for code, label in sorted(tts_langs().items()):
            for tld, region in ACCENTS.get(code, [("com", "")]):
                voices.append(Voice(
                    id=f"{code}|{tld}",
                    name=f"{label}{' · ' + region if region else ''}",
                    lang=code,
                    engine=self.id,
                ))
        return voices

    def synthesize(self, text, voice_id, out_path, *, lang=None, ref_audio=None):
        from gtts import gTTS

        code, _, tld = voice_id.partition("|")
        out_path = out_path.rsplit(".", 1)[0] + ".mp3"
        gTTS(text=text, lang=code, tld=tld or "com").save(out_path)
        return out_path
