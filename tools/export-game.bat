@echo off
chcp 65001 >nul
rem Double-click to export the game into dist\ ; the real work is in export-game.py.
rem Comments here are ASCII on purpose: cmd.exe mis-parses UTF-8 Chinese in a .bat
rem (it splits the line and prints "is not recognized"). Chinese docs live in the .py.
rem Args pass straight through: export-game.bat --min / --zip / --clean / --list / --out PATH
setlocal
set "PY=python"
where python >nul 2>nul || set "PY=py"
"%PY%" "%~dp0export-game.py" %*
echo.
pause
