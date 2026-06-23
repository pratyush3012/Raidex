@echo off
cd /d "%~dp0backend"
echo Starting Raidex backend (SQLite) on http://0.0.0.0:8000 ...
python server_sqlite.py
