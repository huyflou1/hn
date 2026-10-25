@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo === Vocalize - cai dat ===

rem faster-whisper can Python Windows chinh thuc 3.10-3.12 (KHONG dung Python cua MSYS2)
set PYVER=
for %%v in (3.12 3.11 3.10) do (
  if not defined PYVER (
    py -%%v -c "import sys" >nul 2>&1 && set PYVER=%%v
  )
)
if not defined PYVER (
  echo [LOI] Khong tim thay Python 3.10-3.12 ban Windows.
  echo Dang cai Python 3.12 bang winget...
  winget install -e --id Python.Python.3.12 || (
    echo Hay tai Python 3.12 tai https://www.python.org/downloads/ roi chay lai setup.bat
    pause & exit /b 1
  )
  set PYVER=3.12
)
echo Dung Python %PYVER%

where ffmpeg >nul 2>&1 || (
  echo Dang cai ffmpeg bang winget...
  winget install -e --id Gyan.FFmpeg || echo [CANH BAO] Chua cai duoc ffmpeg, hay cai thu cong.
)

if not exist .venv (
  py -%PYVER% -m venv .venv || (echo [LOI] Khong tao duoc .venv & pause & exit /b 1)
)
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements.txt || (
  echo [LOI] Cai thu vien that bai. Chup man hinh loi gui lai nhe.
  pause & exit /b 1
)
python -c "import faster_whisper; print('faster-whisper OK')" || (echo [LOI] faster-whisper chua cai duoc & pause & exit /b 1)
python scripts\download_piper_voices.py
echo.
echo === Xong! Bam dup run.bat de mo app ===
pause
