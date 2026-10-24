"""Video → subtitles → voice-over pipeline built on ffmpeg + faster-whisper + pluggable TTS engines."""
from __future__ import annotations

import json
import math
import re
import shutil
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

from .tts import get_engine, lang_base

SR = 24000  # sample rate of the generated voice track
_whisper_models: dict[str, object] = {}
_whisper_lock = threading.Lock()


# ---------------------------------------------------------------- ffmpeg helpers
def run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"{cmd[0]} lỗi: {proc.stderr.strip()[-800:]}")


def probe(path: str | Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(out)


def media_duration(path: str | Path) -> float:
    return float(probe(path)["format"].get("duration") or 0)


def has_audio(path: str | Path) -> bool:
    return any(s.get("codec_type") == "audio" for s in probe(path)["streams"])


def extract_audio(video: Path, out: Path) -> Path:
    run(["ffmpeg", "-y", "-i", str(video), "-vn", "-ac", "1", "-ar", "16000", str(out)])
    return out


def atempo_chain(tempo: float) -> str:
    """atempo only accepts 0.5–2.0 on older ffmpeg builds, so chain factors."""
    parts = []
    while tempo > 2.0:
        parts.append(2.0)
        tempo /= 2.0
    while tempo < 0.5:
        parts.append(0.5)
        tempo /= 0.5
    parts.append(tempo)
    return ",".join(f"atempo={p:.4f}" for p in parts)


def load_pcm(path: str, tempo: float = 1.0) -> np.ndarray:
    """Decode any audio file to mono float32 at SR, optionally time-stretched."""
    cmd = ["ffmpeg", "-v", "error", "-i", path]
    if abs(tempo - 1.0) > 0.01:
        cmd += ["-filter:a", atempo_chain(tempo)]
    cmd += ["-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def normalize(pcm: np.ndarray, target_rms: float = 0.1, peak: float = 0.9) -> np.ndarray:
    """Level every clip to the same loudness so voices from different engines sound consistent."""
    rms = float(np.sqrt(np.mean(pcm ** 2))) if pcm.size else 0
    if rms < 1e-5:
        return pcm
    gain = target_rms / rms
    gain = min(gain, peak / float(np.max(np.abs(pcm))))
    return pcm * gain


def trim_silence(pcm: np.ndarray, threshold: float = 0.01) -> np.ndarray:
    idx = np.flatnonzero(np.abs(pcm) > threshold)
    if idx.size == 0:
        return pcm
    pad = int(0.03 * SR)
    return pcm[max(0, idx[0] - pad): idx[-1] + pad]


# ---------------------------------------------------------------- subtitles
def fmt_ts(t: float, sep: str = ",") -> str:
    ms = int(round(max(t, 0) * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02}{sep}{ms:03}"


def write_srt(segments: list[dict], path: Path) -> Path:
    lines = []
    for i, seg in enumerate(segments, 1):
        lines += [str(i), f"{fmt_ts(seg['start'])} --> {fmt_ts(seg['end'])}", seg["text"].strip(), ""]
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def write_vtt(segments: list[dict], path: Path) -> Path:
    lines = ["WEBVTT", ""]
    for seg in segments:
        lines += [f"{fmt_ts(seg['start'], '.')} --> {fmt_ts(seg['end'], '.')}", seg["text"].strip(), ""]
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def parse_srt(text: str) -> list[dict]:
    def ts(s: str) -> float:
        h, m, rest = s.strip().replace(".", ",").split(":")
        sec, ms = rest.split(",")
        return int(h) * 3600 + int(m) * 60 + int(sec) + int(ms) / 1000

    segments = []
    for block in re.split(r"\n\s*\n", text.replace("\r\n", "\n").strip()):
        lines = [l for l in block.split("\n") if l.strip()]
        for i, line in enumerate(lines):
            if "-->" in line:
                a, b = line.split("-->")
                body = " ".join(lines[i + 1:]).strip()
                if body:
                    segments.append({"start": ts(a), "end": ts(b.split()[0]), "text": body})
                break
    return segments


# ---------------------------------------------------------------- speech recognition
def transcribe(audio: Path, model_size: str, language: str | None, progress) -> tuple[list[dict], str]:
    from faster_whisper import WhisperModel

    with _whisper_lock:
        if model_size not in _whisper_models:
            progress(0.05, f"Đang tải model Whisper '{model_size}' (lần đầu sẽ hơi lâu)...")
            _whisper_models[model_size] = WhisperModel(model_size, device="auto", compute_type="int8")
        model = _whisper_models[model_size]

    progress(0.15, "Đang nhận dạng giọng nói...")
    # Decode with ffmpeg ourselves: avoids PyAV version mismatches inside faster-whisper.
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(audio), "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    samples = np.frombuffer(raw, dtype=np.float32)
    seg_iter, info = model.transcribe(samples, language=language or None, vad_filter=True, beam_size=5)
    total = info.duration or 1
    segments = []
    for s in seg_iter:
        text = s.text.strip()
        if text:
            segments.append({"start": round(s.start, 3), "end": round(s.end, 3), "text": text})
        progress(0.15 + 0.75 * min(s.end / total, 1), f"Đã nhận dạng {fmt_ts(s.end)[:8]} / {fmt_ts(total)[:8]}")
    return segments, info.language


def _translators(source: str, target: str):
    """Free translators from https://github.com/nidhaloff/deep-translator, as lazy factories tried in order."""
    from deep_translator import GoogleTranslator, MyMemoryTranslator
    from deep_translator.constants import MY_MEMORY_LANGUAGES_TO_CODES

    def mymemory():
        codes = MY_MEMORY_LANGUAGES_TO_CODES.values()
        pick = lambda c: next(x for x in codes if lang_base(x) == lang_base(c))  # noqa: E731
        return MyMemoryTranslator(source=pick(source), target=pick(target))

    return [("Google", lambda: GoogleTranslator(source="auto", target=target)), ("MyMemory", mymemory)]


def _chunks(lines: list[str], limit: int = 450):
    """Group lines into newline-joined batches so one request translates many lines."""
    batch, size = [], 0
    for i, line in enumerate(lines):
        if batch and size + len(line) > limit:
            yield batch
            batch, size = [], 0
        batch.append(i)
        size += len(line) + 1
    if batch:
        yield batch


def translate(segments: list[dict], target: str, source: str, progress) -> tuple[list[dict], str | None]:
    """Returns (segments, warning). On failure the original text is kept and a warning returned."""
    lines = [s["text"].replace("\n", " ") for s in segments]
    out = list(lines)
    batches = list(_chunks(lines))
    last_err = None
    for name, factory in _translators(source, target):
        try:
            tr = factory()
            for n, batch in enumerate(batches):
                joined = "\n".join(lines[i] for i in batch)
                result = (tr.translate(joined) or "").split("\n")
                if len(result) != len(batch):  # translator merged lines: fall back to one by one
                    result = [tr.translate(lines[i]) or lines[i] for i in batch]
                for i, text in zip(batch, result):
                    out[i] = text.strip() or lines[i]
                progress(0.9 + 0.1 * (n + 1) / len(batches), f"Đang dịch phụ đề ({name}) {n + 1}/{len(batches)}")
            return [{**seg, "text": t, "original": seg["text"]} for seg, t in zip(segments, out)], None
        except Exception as e:  # noqa: BLE001
            last_err = f"{name}: {str(e)[:200]}"
    return segments, f"Không dịch được phụ đề ({last_err}). Đang giữ nguyên ngôn ngữ gốc."


# ---------------------------------------------------------------- voice-over
def synth_segment(seg: dict, idx: int, workdir: Path, lang: str | None, ref_audio: str | None) -> str:
    engine = get_engine(seg["engine"])
    out = workdir / f"seg_{idx:04d}.audio"
    last_err = None
    for _ in range(3):  # network engines occasionally drop a request
        try:
            return engine.synthesize(seg["text"], seg["voice"], str(out), lang=lang, ref_audio=ref_audio)
        except Exception as e:  # noqa: BLE001
            last_err = e
    raise RuntimeError(f"Câu {idx + 1} ({engine.name}): {last_err}")


def build_voice_track(segments: list[dict], duration: float, workdir: Path, *, speed: float,
                      max_speedup: float, lang: str | None, ref_audio: str | None, progress) -> Path:
    workdir.mkdir(parents=True, exist_ok=True)
    total_len = int(math.ceil(duration * SR)) + SR
    track = np.zeros(total_len, dtype=np.float32)

    done = 0
    lock = threading.Lock()

    def job(i: int):
        nonlocal done
        path = synth_segment(segments[i], i, workdir, lang, ref_audio)
        with lock:
            done += 1
            progress(0.05 + 0.65 * done / len(segments), f"Đã tạo giọng {done}/{len(segments)} câu")
        return path

    with ThreadPoolExecutor(max_workers=4) as pool:
        paths = list(pool.map(job, range(len(segments))))

    progress(0.72, "Đang căn chỉnh giọng đọc khớp thời gian...")
    for i, (seg, path) in enumerate(zip(segments, paths)):
        start = seg["start"]
        # A line may spill into the silence before the next line, but never overlap it.
        next_start = segments[i + 1]["start"] if i + 1 < len(segments) else duration
        slot = max(next_start - start, seg["end"] - start, 0.3)

        pcm = trim_silence(load_pcm(path))
        natural = len(pcm) / SR / speed
        tempo = speed
        if natural > slot:
            tempo = speed * min(natural / slot, max_speedup)
        if abs(tempo - 1.0) > 0.01:
            pcm = trim_silence(load_pcm(path, tempo))

        pcm = normalize(pcm)
        a = int(start * SR)
        b = min(a + len(pcm), total_len)
        track[a:b] += pcm[: b - a]

    np.clip(track, -1.0, 1.0, out=track)
    out = workdir.parent / "voice.wav"
    pcm16 = (track * 32767).astype("<i2").tobytes()
    import wave

    with wave.open(str(out), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm16)
    return out


def make_reference(audio16k: Path, segments: list[dict], out: Path) -> Path:
    """~15s of speech from the original video, used as the voice-cloning sample."""
    start = segments[0]["start"] if segments else 0
    run(["ffmpeg", "-y", "-ss", f"{start}", "-t", "15", "-i", str(audio16k), "-ar", "22050", str(out)])
    return out


def sub_style(style: dict) -> str:
    def ass_color(hex_color: str) -> str:
        h = hex_color.lstrip("#")
        r, g, b = h[0:2], h[2:4], h[4:6]
        return f"&H00{b}{g}{r}".upper()

    return ",".join([
        f"FontName={style.get('font', 'Arial')}",
        f"FontSize={int(style.get('size', 18))}",
        f"PrimaryColour={ass_color(style.get('color', '#FFFFFF'))}",
        "OutlineColour=&H00000000",
        "BorderStyle=1" if not style.get("box") else "BorderStyle=3",
        "BackColour=&H80000000",
        "Outline=1.5", "Shadow=0", f"MarginV={int(style.get('margin', 24))}",
    ])


def mux(video: Path, voice: Path, srt: Path, out: Path, *, keep_original: bool,
        original_volume: float, voice_volume: float, burn: bool, style: dict, sub_lang: str) -> Path:
    cmd = ["ffmpeg", "-y", "-i", str(video), "-i", str(voice)]
    if not burn:
        cmd += ["-i", str(srt)]

    filters = [f"[1:a]volume={voice_volume:.2f}[vo]"]
    if keep_original and has_audio(video) and original_volume > 0:
        filters += [f"[0:a]volume={original_volume:.2f}[orig]",
                    "[orig][vo]amix=inputs=2:duration=first:normalize=0[aout]"]
    else:
        filters += ["[vo]anull[aout]"]

    if burn:
        # The subtitles filter path needs escaping; copy to a simple name in the job dir instead.
        local = out.parent / "burn.srt"
        shutil.copy(srt, local)
        filters.append(f"[0:v]subtitles=burn.srt:force_style='{sub_style(style)}'[vout]")
        cmd += ["-filter_complex", ";".join(filters), "-map", "[vout]", "-map", "[aout]",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p"]
    else:
        cmd += ["-filter_complex", ";".join(filters), "-map", "0:v:0", "-map", "[aout]", "-map", "2:s",
                "-c:v", "copy", "-c:s", "mov_text", "-metadata:s:s:0", f"language={iso639_2(sub_lang)}"]
    cmd += ["-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out.name]

    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=out.parent)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg lỗi khi xuất video: {proc.stderr.strip()[-800:]}")
    return out


def iso639_2(code: str) -> str:
    table = {"vi": "vie", "en": "eng", "zh": "chi", "ja": "jpn", "ko": "kor", "fr": "fre",
             "de": "ger", "es": "spa", "ru": "rus", "th": "tha", "id": "ind", "pt": "por", "it": "ita"}
    return table.get(lang_base(code), "und")
