@echo off
rem AutoniCK Design Lab: abre o laboratorio visual neste computador (so leitura, sem banco, sem internet).
rem Uso: de dois cliques neste arquivo. Para encerrar, feche esta janela ou aperte Ctrl+C.
rem Precisa so do JDK 21 (o mesmo do AutoniCK). Usa JAVA_HOME se estiver definido.
setlocal
chcp 65001 >nul
set "JAVA=java"
if defined JAVA_HOME set "JAVA=%JAVA_HOME%\bin\java.exe"
cd /d "%~dp0.."
start "" cmd /c "timeout /t 3 >nul & start http://127.0.0.1:8091/refino.html"
"%JAVA%" design-lab\Servidor.java 8091
echo.
echo Design Lab encerrado.
pause
endlocal
