# 🎬 Vocalize by HuyFlou – Tự động tạo phụ đề & lồng tiếng cho video

Tải video lên → app tự **nhận dạng lời thoại thành phụ đề**, (tuỳ chọn) **dịch sang ngôn ngữ khác**,
rồi **lồng tiếng** bằng nhiều giọng đọc lấy từ các dự án mã nguồn mở trên GitHub.
Giao diện dạng block, tiếng Việt, đi theo 4 bước.

![flow](https://img.shields.io/badge/Video-→%20Phụ%20đề%20→%20Giọng%20đọc%20→%20MP4-ff9ec7)

## Tính năng

| Bước | Mô tả |
|---|---|
| 1. Tải video | Kéo thả video, chọn ngôn ngữ gốc (hoặc tự nhận diện), dịch sang ngôn ngữ khác, chọn độ chính xác. Có thể dùng file `.srt` sẵn có. |
| 2. Phụ đề | Mỗi câu là một block: sửa chữ, chỉnh thời gian, nghe thử, gộp / thêm / xoá câu, gán giọng riêng. **Tìm & thay thế** hàng loạt, cảnh báo câu quá dài. **Xuất phụ đề** ngay: `.SRT`, `.VTT`, `.TXT`, **SRT song ngữ** và SRT bản gốc. |
| 3. Giọng đọc | **Gợi ý nhanh** (Nữ/Nam chuẩn, Hội thoại, Kể chuyện, Tin tức, Quảng cáo, Bắc–Trung–Nam...), tab **Tất cả** gộp mọi nguồn, lọc ngôn ngữ/giới tính, nghe thử, tải giọng Piper ngay trong app, tạo **dàn giọng** và phân giọng: một giọng / luân phiên / tự chọn. |
| 4. Xuất video | Tốc độ đọc, âm lượng, giữ âm thanh gốc làm nền, phụ đề bật/tắt được hoặc in cứng (cỡ chữ, màu, nền), phụ đề song ngữ. Tải MP4, SRT, WAV. |

**Trình xem trước nhỏ gọn:** thanh thời gian hiển thị từng câu (màu theo giọng đọc), di chuột xem nội dung câu,
nút câu trước/sau, tốc độ phát, âm lượng, bật/tắt phụ đề, toàn màn hình, chuyển **Gốc ↔ Kết quả**.
Phụ đề xem trước hiển thị đúng kiểu chữ sẽ in vào video.
Phím tắt: `Space`/`K` phát–dừng · `J`/`L` câu trước–sau · `←`/`→` ±5 giây · `C` phụ đề · `F` toàn màn hình.

App tự **căn khớp thời gian** (cắt khoảng lặng, tăng tốc câu quá dài), **cân bằng âm lượng** giữa các engine và
**ghi nhớ cài đặt** (dàn giọng, tuỳ chọn xuất) cho lần sau.

## Nguồn giọng đọc

| Engine | Repo | Giọng tiếng Việt | Ghi chú |
|---|---|---|---|
| Edge TTS | [rany2/edge-tts](https://github.com/rany2/edge-tts) | **24**: HoaiMy, NamMinh × 5 phong cách (Tin tức, Kể chuyện, Trẻ trung, Trầm ấm, Quảng cáo) + 12 giọng đa ngữ (Ava, Andrew, Emma, Brian, Vivienne...) | Cần internet |
| Piper | [rhasspy/piper](https://github.com/rhasspy/piper) | **22**: vais1000, 25hours, vivos (20 người đọc) | Offline, tải giọng ngay trong app; 170+ giọng các ngôn ngữ khác |
| FPT.AI | [fpt.ai/tts](https://fpt.ai/tts) | **9**: Ban Mai, Thu Minh, Lê Minh (Bắc) · Mỹ An, Ngọc Lam, Gia Huy (Trung) · Lan Nhi, Linh San, Minh Quang (Nam) | Cần `FPT_API_KEY` miễn phí |
| Meta MMS | [facebookresearch/fairseq](https://github.com/facebookresearch/fairseq/tree/main/examples/mms) | 1 | Offline, cần `transformers torch` |
| Google TTS | [pndurette/gTTS](https://github.com/pndurette/gTTS) | 1 | Cần internet, rất nhiều ngôn ngữ |
| Kokoro | [hexgrad/kokoro](https://github.com/hexgrad/kokoro) | — | Offline, chất lượng cao (Anh, Pháp, Nhật, Trung...) |
| Coqui XTTS-v2 | [idiap/coqui-ai-TTS](https://github.com/idiap/coqui-ai-TTS) | nhân bản giọng | **Nhân bản giọng gốc** trong video, nên có GPU |
| eSpeak NG | [espeak-ng/espeak-ng](https://github.com/espeak-ng/espeak-ng) | 2 | Giọng máy, siêu nhẹ |

Nhận dạng giọng nói: [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper) ·
Dịch: [nidhaloff/deep-translator](https://github.com/nidhaloff/deep-translator) (Google, dự phòng MyMemory).

Engine nào chưa cài sẽ hiện nhãn **"chưa cài"** kèm lệnh cài đặt; app vẫn chạy với các engine còn lại.

**Bật FPT.AI:** đăng ký tại [console.fpt.ai](https://console.fpt.ai), copy `.env.example` thành `.env` và điền
`FPT_API_KEY=...`, rồi khởi động lại app.

## Cài đặt & chạy

Yêu cầu: Python **3.10–3.12**, `ffmpeg` (có libass để in cứng phụ đề).

**Windows:** bấm đúp `setup.bat` (tự cài Python 3.12, ffmpeg, thư viện, giọng Piper), sau đó bấm đúp `run.bat`.
Không dùng Python của MSYS2/UCRT64 vì faster-whisper (ctranslate2) không có bản cho Python đó.

**Linux/macOS:**

```bash
pip install -r requirements.txt
python scripts/download_piper_voices.py     # tải giọng Piper (Việt + Anh)
python run.py        # tự chọn cổng trống và mở trình duyệt
```

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
