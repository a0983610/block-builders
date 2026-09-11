@echo off
chcp 65001 >nul
rem Double-click to get a menu of the usual test runs; the menu lives in run-tests.py.
rem Comments (and every echo) here are ASCII on purpose: cmd.exe mis-parses UTF-8
rem Chinese in a .bat and prints "is not recognized". Chinese text lives in the .py.
rem Args pass straight through: run-tests.bat --tier must / --tier commit / --list
setlocal
set "PY=python"
where python >nul 2>nul || set "PY=py"
"%PY%" "%~dp0run-tests.py" %*
echo.
pause
