"""Formant synthesizer https://github.com/espeak-ng/espeak-ng — robotic but 100+ languages, fully offline."""
from __future__ import annotations

import shutil
import subprocess
from functools import lru_cache

from .base import TTSEngine, Voice


class EspeakTTS(TTSEngine):
    id = "espeak"
    name = "eSpeak NG"
    repo = "espeak-ng/espeak-ng"
    description = "Giọng máy cổ điển, siêu nhẹ, offline, hơn 100 ngôn ngữ."
    install_hint = "apt install espeak-ng  (macOS: brew install espeak-ng)"

    def _bin(self) -> str | None:
        return shutil.which("espeak-ng") or shutil.which("espeak")

    def available(self) -> bool:
        return self._bin() is not None

    @lru_cache(maxsize=1)
    def list_voices(self) -> list[Voice]:
        out = subprocess.run([self._bin(), "--voices"], capture_output=True, text=True).stdout
        voices = []
        for line in out.splitlines()[1:]:
            cols = line.split()
            if len(cols) < 4:
                continue
            lang, gender, name = cols[1], cols[2], cols[3]
            g = "male" if gender.endswith("M") else "female" if gender.endswith("F") else ""
            for variant, vg in ((lang, g), (f"{lang}+f3", "female")):
                voices.append(Voice(
                    id=variant,
                    name=name.replace("_", " ") + (" (nữ)" if variant.endswith("+f3") else ""),
                    lang=lang, gender=vg, engine=self.id, tags=["offline"],
                ))
        return voices

    def synthesize(self, text, voice_id, out_path, *, lang=None, ref_audio=None):
        out_path = out_path.rsplit(".", 1)[0] + ".wav"
        subprocess.run([self._bin(), "-v", voice_id, "-w", out_path, text],
                       check=True, capture_output=True)
        return out_path
