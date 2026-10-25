# 🎬 Vocalize – Tự động tạo phụ đề & lồng tiếng cho video

Tải video lên → app tự **nhận dạng lời thoại thành phụ đề**, (tuỳ chọn) **dịch sang ngôn ngữ khác**,
rồi **lồng tiếng** bằng nhiều giọng đọc lấy từ các dự án mã nguồn mở trên GitHub.
Giao diện dạng block, tiếng Việt, đi theo 4 bước.

![flow](https://img.shields.io/badge/Video-→%20Phụ%20đề%20→%20Giọng%20đọc%20→%20MP4-ff9ec7)

## Tính năng

| Bước | Mô tả |
|---|---|
| 1. Tải video | Kéo thả video, chọn ngôn ngữ gốc (hoặc tự nhận diện), dịch sang ngôn ngữ khác, chọn độ chính xác. Có thể dùng file `.srt` sẵn có. |
| 2. Phụ đề | Mỗi câu là một block: sửa chữ, chỉnh thời gian, nghe thử, thêm/xoá câu, gán giọng riêng. Xem trước phụ đề trực tiếp trên video. |
| 3. Giọng đọc | Chọn nguồn giọng, lọc theo ngôn ngữ/giới tính, nghe thử, tạo **dàn giọng** và phân giọng: *một giọng*, *luân phiên* hoặc *tự chọn từng câu*. |
| 4. Xuất video | Chỉnh tốc độ đọc, âm lượng, giữ âm thanh gốc làm nền, phụ đề bật/tắt được hoặc in cứng (cỡ chữ, màu, nền). Tải MP4, SRT, WAV. |

Giọng đọc được **tự căn khớp thời gian** (cắt khoảng lặng, tăng tốc câu quá dài) và **cân bằng âm lượng**
giữa các engine.

## Nguồn giọng đọc (GitHub)

| Engine | Repo | Ghi chú |
|---|---|---|
| Edge TTS | [rany2/edge-tts](https://github.com/rany2/edge-tts) | 300+ giọng neural, có tiếng Việt *HoaiMy*, *NamMinh*. Cần internet. |
| Google TTS | [pndurette/gTTS](https://github.com/pndurette/gTTS) | Rất nhiều ngôn ngữ, giọng vùng miền (Anh-Mỹ/Anh/Úc…). Cần internet. |
| Piper | [rhasspy/piper](https://github.com/rhasspy/piper) | Offline, nhanh trên CPU, có giọng Việt (vais1000, 25hours, vivos). |
| Kokoro | [hexgrad/kokoro](https://github.com/hexgrad/kokoro) | Offline, chất lượng rất cao (Anh, Pháp, TBN, Nhật, Trung…). Tuỳ chọn. |
| Coqui XTTS-v2 | [idiap/coqui-ai-TTS](https://github.com/idiap/coqui-ai-TTS) | **Nhân bản giọng gốc** trong video. Nặng, nên có GPU. Tuỳ chọn. |
| eSpeak NG | [espeak-ng/espeak-ng](https://github.com/espeak-ng/espeak-ng) | Giọng máy, siêu nhẹ, 100+ ngôn ngữ. |

Nhận dạng giọng nói: [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper) ·
Dịch: [nidhaloff/deep-translator](https://github.com/nidhaloff/deep-translator) (Google, dự phòng MyMemory).

Engine nào chưa cài sẽ hiện nhãn **"chưa cài"** kèm lệnh cài đặt; app vẫn chạy với các engine còn lại.

## Cài đặt & chạy

Yêu cầu: Python **3.10–3.12**, `ffmpeg` (có libass để in cứng phụ đề).

**Windows:** bấm đúp `setup.bat` (tự cài Python 3.12, ffmpeg, thư viện, giọng Piper), sau đó bấm đúp `run.bat`.
Không dùng Python của MSYS2/UCRT64 vì faster-whisper (ctranslate2) không có bản cho Python đó.

**Linux/macOS:**

```bash
pip install -r requirements.txt
python scripts/download_piper_voices.py     # tải giọng Piper (Việt + Anh)
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Mở http://localhost:8000

Hoặc dùng Docker:

```bash
docker build -t vocalize .
docker run -p 8000:8000 -v $PWD/data:/app/data vocalize
```

Bật engine tuỳ chọn: `pip install kokoro soundfile` hoặc `pip install coqui-tts`, rồi khởi động lại.

## Thêm engine giọng đọc mới

Tạo file trong `app/tts/`, kế thừa `TTSEngine` và hiện thực 3 hàm:

```python
class MyTTS(TTSEngine):
    id, name, repo = "my", "My TTS", "owner/repo"
    def available(self): ...
    def list_voices(self): return [Voice(id="x", name="X", lang="vi-VN", gender="female")]
    def synthesize(self, text, voice_id, out_path, *, lang=None, ref_audio=None): ...  # trả về đường dẫn file audio
```

Rồi đăng ký trong `app/tts/__init__.py`. Giao diện tự hiển thị engine mới.

## Cấu trúc

```
app/
  main.py          API FastAPI + phục vụ giao diện
  pipeline.py      tách audio, Whisper, dịch, ghép giọng, ffmpeg mux
  tts/             các engine giọng đọc (plugin)
  static/          giao diện block (HTML/CSS/JS thuần)
scripts/download_piper_voices.py
data/jobs/<id>/    file tạm & kết quả của từng video
```

## API

| Method | Endpoint | |
|---|---|---|
| GET | `/api/engines` | danh sách engine |
| GET | `/api/voices/{engine}` | danh sách giọng |
| POST | `/api/preview` | nghe thử `{engine, voice, text}` |
| POST | `/api/jobs` | upload video (multipart: `file`, `model`, `language`, `translate_to`, `srt`) |
| GET | `/api/jobs/{id}` | trạng thái, tiến độ, phụ đề |
| POST | `/api/jobs/{id}/render` | tạo giọng + xuất video |
| GET | `/api/jobs/{id}/files/{name}` | tải kết quả |
