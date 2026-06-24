@echo off
color 0B
echo ========================================================
echo        INSTALADOR AUTOMATICO - WMS OFFLINE-FIRST
echo ========================================================
echo.

echo [1/5] Limpando tudo...
if exist "node_modules" rmdir /s /q node_modules
if exist "package-lock.json" del package-lock.json
if exist ".npmrc" del .npmrc

echo.
echo [2/5] Instalando dependencias (ignorando compilacao de C++)...
npm install --ignore-scripts
echo     Dependencias instaladas. Erros do SQLite acima sao esperados e serao corrigidos no passo 4.

echo.
echo [3/5] Baixando executavel do Electron...
node node_modules\electron\install.js
echo     Electron baixado.

echo.
echo [4/5] Baixando SQLite pre-compilado para Electron 31...
node_modules\.bin\electron-builder install-app-deps
echo     SQLite pronto.

echo.
echo [5/5] Iniciando o sistema WMS...
npm run dev

pause
