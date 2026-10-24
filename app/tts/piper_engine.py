"""Fast offline neural TTS via https://github.com/rhasspy/piper.

Voice models (*.onnx + *.onnx.json) are read from voices/piper/.
Download some with: python scripts/download_piper_voices.py
"""
from __future__ import annotations

import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path

from .base import TTSEngine, Voice

VOICE_DIR = Path(__file__).resolve().parents[2] / "voices" / "piper"


class PiperTTS(TTSEngine):
    id = "piper"
    name = "Piper"
    repo = "rhasspy/piper"
    description = "TTS neural chạy offline, rất nhanh trên CPU. Có giọng tiếng Việt (vais1000, 25hours)."
    install_hint = "pip install piper-tts && python scripts/download_piper_voices.py"

    def _cmd(self) -> list[str] | None:
        if shutil.which("piper"):
            return ["piper"]
        if importlib.util.find_spec("piper") is not None:
            return [sys.executable, "-m", "piper"]
        return None

    def available(self) -> bool:
        return self._cmd() is not None and any(VOICE_DIR.glob("*.onnx"))

    def list_voices(self) -> list[Voice]:
        voices = []
        for model in sorted(VOICE_DIR.glob("*.onnx")):
            # vi_VN-vais1000-medium
            stem = model.stem
            parts = stem.split("-")
            lang = parts[0].replace("_", "-")
            name = " ".join(p.capitalize() for p in parts[1:]) or stem
            voices.append(Voice(id=stem, name=name, lang=lang, engine=self.id, tags=["offline"]))
        return voices

    def synthesize(self, text, voice_id, out_path, *, lang=None, ref_audio=None):
        model = VOICE_DIR / f"{Path(voice_id).name}.onnx"
        if not model.exists():
            raise FileNotFoundError(f"Không tìm thấy model Piper: {model.name}")
        out_path = out_path.rsplit(".", 1)[0] + ".wav"
        subprocess.run(
            [*self._cmd(), "--model", str(model), "--output_file", out_path],
            input=text.encode("utf-8"), check=True, capture_output=True,
        )
        return out_path
