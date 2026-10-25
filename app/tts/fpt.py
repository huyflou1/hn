"""FPT.AI Text-to-Speech (https://fpt.ai/tts) — Vietnamese voices with Northern, Central and Southern accents.

Needs a free API key: set FPT_API_KEY in the environment or in a .env file next to requirements.txt.
"""
from __future__ import annotations

import os
import time

from .base import TTSEngine, Voice

API = "https://api.fpt.ai/hmi/tts/v5"
VOICES = [  # id, name, gender, region
    ("banmai", "Ban Mai", "female", "miền Bắc"),
    ("thuminh", "Thu Minh", "female", "miền Bắc"),
    ("leminh", "Lê Minh", "male", "miền Bắc"),
    ("myan", "Mỹ An", "female", "miền Trung"),
    ("ngoclam", "Ngọc Lam", "female", "miền Trung"),
    ("giahuy", "Gia Huy", "male", "miền Trung"),
    ("lannhi", "Lan Nhi", "female", "miền Nam"),
    ("linhsan", "Linh San", "female", "miền Nam"),
    ("minhquang", "Minh Quang", "male", "miền Nam"),
]


class FptTTS(TTSEngine):
    id = "fpt"
    name = "FPT.AI"
    repo = "fpt.ai/tts"
    description = "9 giọng Việt rất tự nhiên theo vùng miền Bắc – Trung – Nam. Cần API key miễn phí."
    install_hint = "Đăng ký tại console.fpt.ai rồi thêm dòng FPT_API_KEY=... vào file .env"
    needs_network = True

    def available(self) -> bool:
        return bool(os.environ.get("FPT_API_KEY"))

    def list_voices(self) -> list[Voice]:
        return [Voice(id=v, name=name, lang="vi-VN", gender=g, engine=self.id, tags=[region])
                for v, name, g, region in VOICES]

    def synthesize(self, text, voice_id, out_path, *, lang=None, ref_audio=None):
        import requests

        r = requests.post(API, data=text.encode("utf-8"), timeout=30, headers={
            "api-key": os.environ["FPT_API_KEY"], "voice": voice_id, "format": "mp3"})
        r.raise_for_status()
        body = r.json()
        if body.get("error") not in (0, None) or not body.get("async"):
            raise RuntimeError(body.get("message") or "FPT.AI từ chối yêu cầu")
        # The mp3 is generated asynchronously; poll its URL until it exists.
        out_path = out_path.rsplit(".", 1)[0] + ".mp3"
        for _ in range(60):
            audio = requests.get(body["async"], timeout=30)
            if audio.status_code == 200 and len(audio.content) > 500:
                with open(out_path, "wb") as f:
                    f.write(audio.content)
                return out_path
            time.sleep(1)
        raise TimeoutError("FPT.AI tạo âm thanh quá lâu")
