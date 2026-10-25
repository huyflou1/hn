@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Chua cai dat. Hay chay setup.bat truoc.
  pause & exit /b 1
)
rem Mo trinh duyet sau khi server khoi dong
start "" cmd /c "timeout /t 3 >nul & start http://localhost:8000"
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
pause
