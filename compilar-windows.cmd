@echo off
setlocal
pushd "%~dp0"
where cargo >nul 2>nul
if errorlevel 1 (
  echo Instale Rust MSVC e Visual Studio C++ Build Tools com Windows SDK.
  popd
  exit /b 1
)
call npm.cmd ci
if errorlevel 1 goto :fail
call npm.cmd run tauri -- build --no-bundle
if errorlevel 1 goto :fail
if not exist artifacts mkdir artifacts
copy /y target\release\leitor-lele.exe artifacts\LeitorLele.exe
if errorlevel 1 goto :fail
echo Executavel: %~dp0artifacts\LeitorLele.exe
popd
exit /b 0
:fail
popd
exit /b 1
