@echo off
cd /d "%~dp0"

REM Kill any existing bot processes first
for /f "tokens=2" %%p in ('wmic process where "commandline like '%%twitter-bot-python%%main.py%%' and name like '%%python%%'" get processid 2^>nul ^| findstr /r "[0-9]"') do taskkill /F /PID %%p >nul 2>&1
for /f "tokens=2" %%p in ('wmic process where "commandline like '%%twitter-bot-python%%colosseum_bot.py%%' and name like '%%python%%'" get processid 2^>nul ^| findstr /r "[0-9]"') do taskkill /F /PID %%p >nul 2>&1
timeout /t 2 /nobreak >nul

REM Start one of each
start "" /B ".venv\Scripts\pythonw.exe" main.py
start "" /B ".venv\Scripts\pythonw.exe" colosseum_bot.py
echo Bots launched (old processes killed first).
