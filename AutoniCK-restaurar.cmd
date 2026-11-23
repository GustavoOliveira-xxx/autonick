@echo off
rem AutoniCK: APAGA os dados da demonstracao local e abre de novo com o cenario ficticio inicial.
setlocal
chcp 65001 >nul
echo Isto apaga o que foi feito na demonstracao local e volta ao cenario ficticio inicial.
set /p "RESPOSTA=Digite RESTAURAR para continuar: "
if /i not "%RESPOSTA%"=="RESTAURAR" (
  echo Nada foi alterado.
  pause
  exit /b 0
)
call "%~dp0AutoniCK-local.cmd" --restaurar
endlocal
