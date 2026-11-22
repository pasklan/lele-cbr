@echo off
setlocal
set "LELE_LIBRARY_DIR=%~dp0hqs"
if not exist "%~dp0artifacts\LeitorLele.exe" (
  echo Executavel nao encontrado. Rode compilar-windows.cmd primeiro.
  pause
  exit /b 1
)
start "" "%~dp0artifacts\LeitorLele.exe"
