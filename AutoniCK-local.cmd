@echo off
rem AutoniCK: demonstracao LOCAL completa (PWA + API Java + PostgreSQL 18 portatil), so neste computador.
rem
rem Uso: de dois cliques neste arquivo. Para voltar ao cenario ficticio inicial: AutoniCK-restaurar.cmd
rem
rem Precisa so do JDK 21 (Eclipse Temurin) em JAVA_HOME. Nao usa PostgreSQL instalado, Docker nem servico do Windows.
rem Os dados ficticios ficam em %LOCALAPPDATA%\AutoniCK\demonstracao-local e continuam entre execucoes.
setlocal
chcp 65001 >nul
if not defined JAVA_HOME (
  echo Defina JAVA_HOME para a pasta do JDK 21 [Eclipse Temurin] e rode de novo.
  pause
  exit /b 1
)
if not exist "%JAVA_HOME%\bin\java.exe" (
  echo JAVA_HOME nao aponta para um JDK: "%JAVA_HOME%"
  pause
  exit /b 1
)
rem O PostgreSQL portatil usa o runtime Visual C++ 2015-2022; o JDK Temurin traz essas DLLs na pasta bin.
set "PATH=%JAVA_HOME%\bin;%PATH%"
cd /d "%~dp0java\demo-pwa-local"
call mvnw.cmd -q compile exec:java -Dautonick.main=br.com.ckgroup.autonick.demo.AutonickLocal -Dexec.args="%*"
echo.
echo AutoniCK encerrado. Os dados da demonstracao continuam guardados.
pause
endlocal
