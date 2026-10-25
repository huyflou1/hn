"""Microsoft Edge neural voices via https://github.com/rany2/edge-tts (300+ voices, 100+ languages)."""
from __future__ import annotations

import asyncio
import importlib.util
from functools import lru_cache

from .base import TTSEngine, Voice

# Speaking styles built from rate/pitch tweaks, offered for the Vietnamese voices.
VI_PRESETS = [
    ("Tin tức", "+8%", "+0Hz"),
    ("Kể chuyện", "-10%", "-4Hz"),
    ("Trẻ trung", "+5%", "+25Hz"),
    ("Trầm ấm", "-5%", "-18Hz"),
    ("Quảng cáo", "+18%", "+10Hz"),
]


class EdgeTTS(TTSEngine):
    id = "edge"
    name = "Edge TTS"
    repo = "rany2/edge-tts"
    description = ("Giọng neural Microsoft. Tiếng Việt: HoaiMy, NamMinh, 5 phong cách đọc "
                   "và 12 giọng đa ngữ (Ava, Andrew, Emma...) đọc được tiếng Việt.")
    install_hint = "pip install edge-tts"
    needs_network = True

    def available(self) -> bool:
        return importlib.util.find_spec("edge_tts") is not None

    @lru_cache(maxsize=1)
    def list_voices(self) -> list[Voice]:
        import edge_tts

        raw = asyncio.run(edge_tts.list_voices())
        voices, presets = [], []
        for v in raw:
            short = v["ShortName"]
            # "vi-VN-HoaiMyNeural" -> "HoaiMy"
            nice = short.split("-", 2)[-1].replace("Neural", "")
            gender = v.get("Gender", "").lower()
            tags = list(v.get("VoiceTag", {}).get("VoicePersonalities", []) or [])[:2]
            if "Multilingual" in short:
                # Multilingual voices read any language (verified for Vietnamese).
                voices.append(Voice(id=short, name=f"{nice.replace('Multilingual', '')} · đa ngữ",
                                    lang="*", gender=gender, engine=self.id,
                                    tags=["đa ngôn ngữ", v["Locale"]]))
                continue
            voices.append(Voice(id=short, name=nice, lang=v["Locale"], gender=gender,
                                engine=self.id, tags=tags))
            if v["Locale"] == "vi-VN":
                presets += [Voice(id=f"{short}|{rate}|{pitch}", name=f"{nice} · {style}", lang="vi-VN",
                                  gender=gender, engine=self.id, tags=["phong cách"])
                            for style, rate, pitch in VI_PRESETS]
        return voices + presets

    def synthesize(self, text, voice_id, out_path, *, lang=None, ref_audio=None):
        import edge_tts

        short, *style = voice_id.split("|")
        rate, pitch = (style + ["+0%", "+0Hz"])[:2]
        out_path = out_path.rsplit(".", 1)[0] + ".mp3"

        async def run():
            await edge_tts.Communicate(text, short, rate=rate, pitch=pitch).save(out_path)

        asyncio.run(run())
        return out_path
