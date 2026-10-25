@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Chua cai dat. Hay chay setup.bat truoc.
  pause & exit /b 1
)
rem Tu tim cong trong va mo trinh duyet
.venv\Scripts\python.exe run.py %*
pause
