@echo off
rem Build the BlockBuilders desktop exe. Double-click to run.
rem Output: dist\BlockBuilders-<version>-portable.exe (version comes from package.json).
rem Same version overwrites the exe in dist. Close the game first, or the exe is locked.
rem Build requirements and first-time setup: see the .md notes next to this file.
rem Keep this file ASCII-only: cmd.exe misparses Chinese text in .bat/.cmd files.

rem Run from this file's folder no matter where it is launched from
cd /d "%~dp0"

call npm run dist
if errorlevel 1 goto fail

rem Remove build intermediates (unpacked app folder, debug log); keep only the exe
if exist "dist\win-unpacked" rmdir /s /q "dist\win-unpacked"
if exist "dist\builder-debug.yml" del /q "dist\builder-debug.yml"

echo.
echo Build finished:
dir /b "dist\*.exe"
pause
exit /b 0

:fail
echo.
echo Build FAILED. See the messages above.
pause
exit /b 1
