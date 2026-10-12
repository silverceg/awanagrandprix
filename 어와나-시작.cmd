@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 24를 먼저 설치한 뒤 다시 실행해 주세요.
  echo https://nodejs.org/
  pause
  exit /b 1
)
node scripts\start-local.js
if errorlevel 1 pause
endlocal
