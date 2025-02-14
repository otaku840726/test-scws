#!/bin/bash

# 獲取腳本自身所在的目錄
SCRIPT_DIR="/workspaces/scwrtc"

# 定義一個函數以處理停止信號
cleanup() {
    echo "捕獲停止信號，正在關閉所有進程..."
    pkill -P $$
    wait
    exit 0
}

# 設置停止信號處理器
trap cleanup SIGINT SIGTERM

adb devices


chmod +x $SCRIPT_DIR/packages/ui/patch.sh

# Start Caddy server with specific configuration
cd $SCRIPT_DIR && chmod +x ./adb_connect.sh && chmod +x ./caddy && ./caddy run --config ./Caddyfile & 

cd $SCRIPT_DIR/packages/api && pnpm run build-and-start & 
# Run the build-and-start script in the background using pnpm

# Change to the UI directory and force run Vite
cd "$SCRIPT_DIR/packages/ui" && npx vite --force & 

cd $SCRIPT_DIR && ./adb_connect.sh

# 等待所有後臺進程結束
wait