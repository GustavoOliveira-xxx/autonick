@echo off
rem AutoniCK: confere o AutoniCK local que esta aberto (so leitura). Abra o AutoniCK-local.cmd antes.
setlocal
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\validar-local.ps1"
echo.
pause
endlocal