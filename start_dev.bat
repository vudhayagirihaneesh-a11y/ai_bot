@echo off
cd /d "c:\Users\vudha\Downloads\ai_bot"
taskkill /F /IM node.exe 2>nul
echo STARTING > dev.log
node node_modules\next\dist\bin\next dev --port 3000 >> dev.log 2>&1

