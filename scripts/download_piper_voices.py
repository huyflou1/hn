"""Download Piper voice models (from https://github.com/rhasspy/piper, hosted on Hugging Face).

Usage:
    python scripts/download_piper_voices.py                 # default Vietnamese + English set
    python scripts/download_piper_voices.py vi_VN-25hours_single-low en_GB-alba-medium
Full list: https://huggingface.co/rhasspy/piper-voices/blob/main/voices.json
"""
import sys
import urllib.request
from pathlib import Path

BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main"
DEFAULT = [
    "vi_VN-vais1000-medium",
    "vi_VN-25hours_single-low",
    "vi_VN-vivos-x_low",
    "en_US-lessac-medium",
    "en_US-ryan-high",
    "en_GB-alba-medium",
]
DEST = Path(__file__).resolve().parents[1] / "voices" / "piper"


def url_for(name: str, ext: str) -> str:
    locale, speaker, quality = name.split("-")
    return f"{BASE}/{locale.split('_')[0]}/{locale}/{speaker}/{quality}/{name}{ext}"


def main(names: list[str]) -> None:
    DEST.mkdir(parents=True, exist_ok=True)
    for name in names:
        for ext in (".onnx", ".onnx.json"):
            target = DEST / f"{name}{ext}"
            if target.exists():
                continue
            print(f"↓ {target.name}")
            try:
                urllib.request.urlretrieve(url_for(name, ext), target)
            except Exception as e:  # noqa: BLE001
                target.unlink(missing_ok=True)
                print(f"  ✗ {e}")
    print(f"Done → {DEST}")


if __name__ == "__main__":
    main(sys.argv[1:] or DEFAULT)
