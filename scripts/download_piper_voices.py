"""Download Piper voice models (from https://github.com/rhasspy/piper, hosted on Hugging Face).

Usage:
    python scripts/download_piper_voices.py                 # default Vietnamese + English set
    python scripts/download_piper_voices.py vi_VN-25hours_single-low en_GB-alba-medium
Full list: https://huggingface.co/rhasspy/piper-voices/blob/main/voices.json
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.tts.piper_engine import VOICE_DIR, download_model  # noqa: E402

DEFAULT = [
    "vi_VN-vais1000-medium",
    "vi_VN-25hours_single-low",
    "vi_VN-vivos-x_low",
    "en_US-lessac-medium",
    "en_US-ryan-high",
    "en_GB-alba-medium",
]


def main(names: list[str]) -> None:
    for name in names:
        print(f"↓ {name}")
        try:
            download_model(name)
        except Exception as e:  # noqa: BLE001
            print(f"  ✗ {e}")
    print(f"Done → {VOICE_DIR}")


if __name__ == "__main__":
    main(sys.argv[1:] or DEFAULT)
