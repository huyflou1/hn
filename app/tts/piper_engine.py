"""Fast offline neural TTS via https://github.com/rhasspy/piper.

Voice models (*.onnx + *.onnx.json) live in voices/piper/. Models not yet on disk are listed from the
official catalog and can be downloaded from the UI (or with scripts/download_piper_voices.py).
"""
from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
import threading
import urllib.request
from functools import lru_cache
from pathlib import Path

from .base import TTSEngine, Voice

VOICE_DIR = Path(__file__).resolve().parents[2] / "voices" / "piper"
HF_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main"
# Used when the online catalog can't be fetched.
FALLBACK_CATALOG = [
    "vi_VN-vais1000-medium", "vi_VN-25hours_single-low", "vi_VN-vivos-x_low",
    "en_US-lessac-medium", "en_US-ryan-high", "en_US-amy-medium", "en_GB-alba-medium",
]
MAX_SPEAKERS = 20  # multi-speaker models (e.g. vivos: 65 speakers) expose this many as separate voices
_download_lock = threading.Lock()


def model_url(name: str, ext: str) -> str:
    locale, speaker, quality = name.split("-")
    return f"{HF_BASE}/{locale.split('_')[0]}/{locale}/{speaker}/{quality}/{name}{ext}"


def download_model(name: str) -> Path:
    """Download one model (+ its config) into VOICE_DIR. Safe to call concurrently."""
    VOICE_DIR.mkdir(parents=True, exist_ok=True)
    with _download_lock:
        for ext in (".onnx.json", ".onnx"):
            target = VOICE_DIR / f"{name}{ext}"
            if target.exists():
                continue
            tmp = target.with_suffix(target.suffix + ".part")
            try:
                urllib.request.urlretrieve(model_url(name, ext), tmp)
                tmp.rename(target)
            finally:
                tmp.unlink(missing_ok=True)
    return VOICE_DIR / f"{name}.onnx"


class PiperTTS(TTSEngine):
    id = "piper"
    name = "Piper"
    repo = "rhasspy/piper"
    description = ("TTS neural chạy offline, nhanh trên CPU. Giọng Việt: vais1000, 25hours và "
                   "vivos (nhiều người đọc). Bấm ⬇ để tải giọng ngay trong app.")
    install_hint = "pip install piper-tts"

    def _cmd(self) -> list[str] | None:
        if shutil.which("piper"):
            return ["piper"]
        if importlib.util.find_spec("piper") is not None:
            return [sys.executable, "-m", "piper"]
        return None

    def available(self) -> bool:
        return self._cmd() is not None

    @lru_cache(maxsize=1)
    def catalog(self) -> dict[str, float]:
        """Model name -> size in MB, from the official voices.json."""
        try:
            with urllib.request.urlopen(f"{HF_BASE}/voices.json", timeout=10) as r:
                data = json.load(r)
            out = {}
            for key, info in data.items():
                size = sum(f.get("size_bytes", 0) for p, f in info.get("files", {}).items() if p.endswith(".onnx"))
                out[key] = round(size / 1e6, 1)
            return out
        except Exception:  # noqa: BLE001
            return {name: 0 for name in FALLBACK_CATALOG}

    @staticmethod
    def _describe(stem: str) -> tuple[str, str]:
        # vi_VN-vais1000-medium -> ("vi-VN", "Vais1000 · medium")
        locale, speaker, quality = (stem.split("-") + ["", ""])[:3]
        return locale.replace("_", "-"), f"{speaker.replace('_', ' ').capitalize()} · {quality.replace('_', ' ')}"

    def list_voices(self) -> list[Voice]:
        voices = []
        installed = set()
        for model in sorted(VOICE_DIR.glob("*.onnx")):
            stem = model.stem
            installed.add(stem)
            lang, name = self._describe(stem)
            speakers = self._speakers(model)
            if len(speakers) <= 1:
                voices.append(Voice(id=stem, name=name, lang=lang, engine=self.id, tags=["offline"]))
            else:
                voices += [Voice(id=f"{stem}#{sid}", name=f"{name} · {label}", lang=lang, engine=self.id,
                                 tags=["offline", "nhiều người đọc"])
                           for label, sid in speakers[:MAX_SPEAKERS]]
        for stem, size in sorted(self.catalog().items()):
            if stem not in installed:
                lang, name = self._describe(stem)
                voices.append(Voice(id=stem, name=name, lang=lang, engine=self.id,
                                    tags=["chưa tải"], installed=False, size_mb=size))
        return voices

    @staticmethod
    def _speakers(model: Path) -> list[tuple[str, int]]:
        try:
            cfg = json.loads(model.with_suffix(".onnx.json").read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            return []
        id_map = cfg.get("speaker_id_map") or {}
        if id_map:
            ids = sorted(id_map.values())
        else:
            ids = list(range(int(cfg.get("num_speakers") or 1)))
        return [(f"Người đọc {n}", sid) for n, sid in enumerate(ids, 1)] if len(ids) > 1 else []

    def download(self, voice_id: str) -> None:
        stem = voice_id.split("#")[0]
        if stem not in self.catalog() and stem not in FALLBACK_CATALOG:
            raise ValueError(f"Giọng Piper không có trong danh mục: {stem}")
        download_model(stem)

    def synthesize(self, text, voice_id, out_path, *, lang=None, ref_audio=None):
        stem, _, speaker = voice_id.partition("#")
        model = VOICE_DIR / f"{Path(stem).name}.onnx"
        if not model.exists():
            self.download(stem)
        out_path = out_path.rsplit(".", 1)[0] + ".wav"
        cmd = [*self._cmd(), "--model", str(model), "--output_file", out_path]
        if speaker:
            cmd += ["--speaker", speaker]
        subprocess.run(cmd, input=text.encode("utf-8"), check=True, capture_output=True)
        return out_path
