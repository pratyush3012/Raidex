@echo off
cd /d "%~dp0backend"
echo Starting Raidex backend (MongoDB, server:app) on http://0.0.0.0:8000 ...
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
