"""HTTP API + static UI. Run with:  uvicorn app.main:app --reload"""
from __future__ import annotations

import asyncio
import os
import shutil
import threading
import time
import traceback
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import pipeline
from .tts import ENGINES, get_engine

ROOT = Path(__file__).resolve().parent
DATA = ROOT.parent / "data"
JOBS_DIR = DATA / "jobs"
PREVIEW_DIR = DATA / "previews"
for d in (JOBS_DIR, PREVIEW_DIR):
    d.mkdir(parents=True, exist_ok=True)



def load_dotenv(path: Path) -> None:
    """Minimal .env reader (KEY=VALUE per line) so API keys like FPT_API_KEY can live in a file."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.strip().partition("=")
        if sep and key and not key.startswith("#"):
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_dotenv(ROOT.parent / ".env")

app = FastAPI(title="Vocalize – phụ đề & lồng tiếng tự động")
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()


# ---------------------------------------------------------------- job helpers
def new_job(filename: str) -> dict:
    jid = uuid.uuid4().hex[:12]
    job = {
        "id": jid, "filename": filename, "status": "uploaded", "progress": 0.0, "message": "",
        "segments": [], "language": None, "warning": None, "duration": 0.0, "outputs": {}, "error": None,
        "created": time.time(),
    }
    with JOBS_LOCK:
        JOBS[jid] = job
    (JOBS_DIR / jid).mkdir(parents=True, exist_ok=True)
    return job


def get_job(jid: str) -> dict:
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404, "Không tìm thấy công việc")
    return job


def reporter(job: dict):
    def report(p: float, msg: str):
        job["progress"] = round(min(max(p, 0), 1), 3)
        job["message"] = msg
    return report


def run_in_thread(job: dict, fn, *args):
    def wrapper():
        try:
            fn(job, *args)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            job["status"] = "error"
            job["error"] = str(e)
            job["message"] = "Có lỗi xảy ra"
    threading.Thread(target=wrapper, daemon=True).start()


# ---------------------------------------------------------------- stage 1: subtitles
def do_transcribe(job: dict, model: str, language: str | None, translate_to: str | None, srt_text: str | None):
    jdir = JOBS_DIR / job["id"]
    report = reporter(job)
    job["status"] = "transcribing"
    report(0.02, "Đang tách âm thanh từ video...")
    video = jdir / job["source"]
    job["duration"] = pipeline.media_duration(video)
    audio = jdir / "audio16k.wav"
    if pipeline.has_audio(video):
        pipeline.extract_audio(video, audio)

    if srt_text:
        segments = pipeline.parse_srt(srt_text)
        lang = language or translate_to or "vi"
    else:
        if not audio.exists():
            raise RuntimeError("Video không có âm thanh — hãy tải kèm file phụ đề .srt")
        segments, lang = pipeline.transcribe(audio, model, language, report)
    if not segments:
        raise RuntimeError("Không nhận dạng được lời thoại nào trong video")

    job["source_language"] = lang
    if translate_to and pipeline.lang_base(translate_to) != pipeline.lang_base(lang):
        segments, warning = pipeline.translate(segments, translate_to, lang, report)
        if warning:
            job["warning"] = warning
        else:
            lang = translate_to
    job["segments"] = segments
    job["language"] = lang
    job["status"] = "ready"
    report(1.0, f"Xong! {len(segments)} câu phụ đề")


@app.post("/api/jobs")
async def create_job(
    file: UploadFile = File(...),
    model: str = Form("small"),
    language: str = Form(""),
    translate_to: str = Form(""),
    srt: UploadFile | None = File(None),
):
    job = new_job(file.filename or "video.mp4")
    ext = Path(file.filename or "video.mp4").suffix.lower() or ".mp4"
    job["source"] = f"source{ext}"
    with open(JOBS_DIR / job["id"] / job["source"], "wb") as f:
        shutil.copyfileobj(file.file, f)
    srt_text = (await srt.read()).decode("utf-8-sig", errors="replace") if srt and srt.filename else None
    run_in_thread(job, do_transcribe, model, language or None, translate_to or None, srt_text)
    return public(job)


# ---------------------------------------------------------------- stage 2: voice + export
class Segment(BaseModel):
    start: float
    end: float
    text: str
    engine: str
    voice: str
    original: str | None = None


class SubStyle(BaseModel):
    font: str = "Arial"
    size: int = 18
    color: str = "#FFFFFF"
    box: bool = False
    margin: int = 24


class RenderRequest(BaseModel):
    segments: list[Segment]
    speed: float = Field(1.0, ge=0.5, le=2.0)
    max_speedup: float = Field(1.6, ge=1.0, le=3.0)
    keep_original: bool = True
    original_volume: float = Field(0.15, ge=0, le=1.5)
    voice_volume: float = Field(1.0, ge=0, le=3)
    burn_subtitles: bool = False
    bilingual: bool = False      # subtitles show the original line under the translation
    style: SubStyle = SubStyle()


def do_render(job: dict, req: RenderRequest):
    jdir = JOBS_DIR / job["id"]
    report = reporter(job)
    job["status"] = "rendering"
    job["outputs"] = {}
    segments = sorted((s.model_dump() for s in req.segments if s.text.strip()), key=lambda s: s["start"])
    job["segments"] = segments

    srt = pipeline.write_srt(segments, jdir / "subtitles.srt", bilingual=req.bilingual)
    pipeline.write_vtt(segments, jdir / "subtitles.vtt", bilingual=req.bilingual)

    ref = None
    if any(s["voice"].startswith("clone:") for s in segments):
        audio16k = jdir / "audio16k.wav"
        if not audio16k.exists():
            raise RuntimeError("Video không có âm thanh gốc để nhân bản giọng")
        ref = str(pipeline.make_reference(audio16k, segments, jdir / "reference.wav"))

    report(0.03, "Đang tạo giọng đọc...")
    seg_dir = jdir / "segments"
    shutil.rmtree(seg_dir, ignore_errors=True)
    voice = pipeline.build_voice_track(
        segments, job["duration"], seg_dir, speed=req.speed, max_speedup=req.max_speedup,
        lang=job.get("language"), ref_audio=ref, progress=report,
    )
    report(0.8, "Đang ghép giọng đọc và phụ đề vào video...")
    out = pipeline.mux(
        jdir / job["source"], voice, srt, jdir / "output.mp4",
        keep_original=req.keep_original, original_volume=req.original_volume,
        voice_volume=req.voice_volume, burn=req.burn_subtitles, style=req.style.model_dump(),
        sub_lang=job.get("language") or "und",
    )
    job["outputs"] = {"video": out.name, "srt": "subtitles.srt", "vtt": "subtitles.vtt", "voice": voice.name}
    job["status"] = "done"
    report(1.0, "Hoàn tất! Video đã sẵn sàng.")


@app.post("/api/jobs/{jid}/render")
def render(jid: str, req: RenderRequest):
    job = get_job(jid)
    if job["status"] in ("transcribing", "rendering"):
        raise HTTPException(409, "Công việc đang chạy")
    if not req.segments:
        raise HTTPException(400, "Chưa có câu phụ đề nào")
    for s in req.segments:
        if s.engine not in ENGINES:
            raise HTTPException(400, f"Engine không hợp lệ: {s.engine}")
    run_in_thread(job, do_render, req)
    job["status"] = "rendering"
    job["progress"] = 0
    return public(job)


def public(job: dict) -> dict:
    return {k: v for k, v in job.items() if k not in ("created",)}


@app.get("/api/jobs/{jid}")
def job_status(jid: str):
    return public(get_job(jid))


@app.get("/api/jobs/{jid}/source")
def job_source(jid: str):
    job = get_job(jid)
    return FileResponse(JOBS_DIR / jid / job["source"])


@app.get("/api/jobs/{jid}/files/{name}")
def job_file(jid: str, name: str):
    job = get_job(jid)
    if name not in job["outputs"].values():
        raise HTTPException(404, "Không có file này")
    stem = Path(job["filename"]).stem
    return FileResponse(JOBS_DIR / jid / name, filename=f"{stem}_{name}")


# ---------------------------------------------------------------- voices
API_VERSION = 2  # bump when the UI starts depending on new endpoints/fields


@app.get("/api/version")
def version():
    return {"version": API_VERSION}


@app.get("/api/engines")
def engines():
    return [e.info() for e in ENGINES.values()]


@app.get("/api/voices/{engine_id}")
async def voices(engine_id: str):
    try:
        engine = get_engine(engine_id)
    except KeyError as e:
        raise HTTPException(404, str(e))
    if not engine.available():
        raise HTTPException(400, f"{engine.name} chưa được cài. {engine.install_hint}")
    try:
        result = await asyncio.to_thread(engine.list_voices)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Không lấy được danh sách giọng của {engine.name}: {e}")
    return [v.to_dict() for v in result]


class DownloadRequest(BaseModel):
    voice: str


@app.post("/api/voices/{engine_id}/download")
async def download_voice(engine_id: str, req: DownloadRequest):
    """Fetch a voice model that isn't on disk yet (Piper)."""
    try:
        engine = get_engine(engine_id)
    except KeyError as e:
        raise HTTPException(404, str(e))
    if not hasattr(engine, "download"):
        raise HTTPException(400, f"{engine.name} không cần tải giọng")
    try:
        await asyncio.to_thread(engine.download, req.voice)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Tải giọng thất bại: {e}")
    return [v.to_dict() for v in await asyncio.to_thread(engine.list_voices)]


class PreviewRequest(BaseModel):
    engine: str
    voice: str
    text: str = Field(..., max_length=300)
    lang: str | None = None


@app.post("/api/preview")
async def preview(req: PreviewRequest):
    try:
        engine = get_engine(req.engine)
    except KeyError as e:
        raise HTTPException(404, str(e))
    if req.voice.startswith("clone:"):
        raise HTTPException(400, "Giọng nhân bản chỉ nghe được khi xuất video")
    for old in PREVIEW_DIR.iterdir():  # previews are throwaway: drop ones older than an hour
        if time.time() - old.stat().st_mtime > 3600:
            old.unlink(missing_ok=True)
    out = PREVIEW_DIR / f"{uuid.uuid4().hex}.audio"
    try:
        path = await asyncio.to_thread(engine.synthesize, req.text, req.voice, str(out), lang=req.lang)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"{engine.name}: {e}")
    return FileResponse(path)


app.mount("/", StaticFiles(directory=ROOT / "static", html=True), name="static")
