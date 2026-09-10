@echo off
rem ---------------------------------------------------------------------------
rem  tikhub とゲームを最新版に更新します。**このファイルをダブルクリック**
rem  するだけで動きます。
rem
rem  npm run update と中身は同じですが、npm を経由しません。
rem  Windows の PowerShell は既定でスクリプトの実行を止めるので、
rem  npm run ... が
rem
rem      npm : このシステムではスクリプトの実行が無効になっているため、
rem            ファイル ...\npm.ps1 を読み込むことができません。
rem
rem  で止まることがあります。ここは node を直接呼ぶため、その設定に
rem  関係なく動きます。
rem ---------------------------------------------------------------------------

rem このファイルが置いてあるフォルダへ移動します。
rem どこから開いても tikhub のフォルダで実行されます。
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js が見つかりません。
  echo   https://nodejs.org/ja から LTS 版を入れてから、
  echo   もう一度このファイルを開いてください。
  echo.
  pause
  exit /b 1
)

node tools\update.js %*

echo.
pause
