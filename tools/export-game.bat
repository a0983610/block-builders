@echo off
chcp 65001 >nul
rem 雙擊這支就會把遊戲匯出成一個資料夾（預設 dist\積木小人-v版號）。
rem 真正做事的是旁邊的 export-game.py；這支只負責切 UTF-8、找 python、跑完停住讓你看結果。
rem 參數照丟：export-game.bat --min / --zip / --clean / --list / --out D:\給同事
setlocal
set "PY=python"
where python >nul 2>nul || set "PY=py"
"%PY%" "%~dp0export-game.py" %*
echo.
pause
