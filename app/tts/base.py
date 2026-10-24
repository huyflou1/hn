"""Common interface for every text-to-speech engine plugged into the app."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass
class Voice:
    id: str
    name: str
    lang: str            # BCP-47-ish: "vi-VN", "en", ...
    gender: str = ""     # "female" | "male" | ""
    engine: str = ""
    tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


class TTSEngine:
    id: str = ""
    name: str = ""
    repo: str = ""            # GitHub repo the engine comes from
    description: str = ""
    install_hint: str = ""
    needs_network: bool = False

    def available(self) -> bool:
        raise NotImplementedError

    def list_voices(self) -> list[Voice]:
        raise NotImplementedError

    def synthesize(self, text: str, voice_id: str, out_path: str, *,
                   lang: str | None = None, ref_audio: str | None = None) -> str:
        """Write speech for `text` to `out_path` (any audio container ffmpeg reads).

        Returns the path actually written (an engine may change the extension).
        """
        raise NotImplementedError

    def info(self) -> dict:
        ok = False
        try:
            ok = self.available()
        except Exception:
            ok = False
        return {
            "id": self.id,
            "name": self.name,
            "repo": self.repo,
            "description": self.description,
            "install_hint": self.install_hint,
            "needs_network": self.needs_network,
            "available": ok,
        }


def lang_base(code: str | None) -> str:
    return (code or "").replace("_", "-").split("-")[0].lower()
