@echo off
cd /d "%~dp0frontend"
echo Starting Expo dev server (scan QR with Expo Go on your phone)...
call npx expo start --lan
