"""Microsoft Edge neural voices via https://github.com/rany2/edge-tts (400+ voices, 100+ languages)."""
from __future__ import annotations

import asyncio
import importlib.util
from functools import lru_cache

from .base import TTSEngine, Voice


class EdgeTTS(TTSEngine):
    id = "edge"
    name = "Edge TTS"
    repo = "rany2/edge-tts"
    description = "Hơn 400 giọng neural tự nhiên của Microsoft, có tiếng Việt (HoaiMy, NamMinh)."
    install_hint = "pip install edge-tts"
    needs_network = True

    def available(self) -> bool:
        return importlib.util.find_spec("edge_tts") is not None

    @lru_cache(maxsize=1)
    def list_voices(self) -> list[Voice]:
        import edge_tts

        raw = asyncio.run(edge_tts.list_voices())
        voices = []
        for v in raw:
            short = v["ShortName"]
            # "vi-VN-HoaiMyNeural" -> "HoaiMy"
            nice = short.split("-", 2)[-1].replace("Neural", "")
            tags = list(v.get("VoiceTag", {}).get("VoicePersonalities", []) or [])
            voices.append(Voice(
                id=short,
                name=nice,
                lang=v["Locale"],
                gender=v.get("Gender", "").lower(),
                engine=self.id,
                tags=tags[:3],
            ))
        return voices

    def synthesize(self, text, voice_id, out_path, *, lang=None, ref_audio=None):
        import edge_tts

        out_path = out_path.rsplit(".", 1)[0] + ".mp3"

        async def run():
            await edge_tts.Communicate(text, voice_id).save(out_path)

        asyncio.run(run())
        return out_path
