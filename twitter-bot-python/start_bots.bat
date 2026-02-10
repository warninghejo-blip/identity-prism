@echo off
cd /d "%~dp0"
start "" /B ".venv\Scripts\pythonw.exe" run_twitter_bot.py
start "" /B ".venv\Scripts\pythonw.exe" run_colosseum_bot.py
echo Bots launched.
