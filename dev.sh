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

# 檢查 adb 是否存在
if ! command -v adb &> /dev/null; then
    echo "adb 未安裝，正在安裝..."

    # 下載 platform-tools
    wget https://dl.google.com/android/repository/platform-tools-latest-linux.zip

    # 解壓縮
    unzip platform-tools-latest-linux.zip

    # 將 adb 複製到 /usr/bin
    sudo cp platform-tools/adb /usr/bin/adb

    # 清理下載的 zip 文件和解壓後的目錄
    rm platform-tools-latest-linux.zip
    rm -rf platform-tools

    echo "adb 安裝完成！"
else
    echo "adb 已安裝。"
fi

npm i -g pnpm
# npm i -g node-pre-gyp

pnpm recursive install

# npm install wrtc
chmod +x $SCRIPT_DIR/packages/ui/patch.sh

cd $SCRIPT_DIR/packages/ui && ./patch.sh && pnpm run build 

cd $SCRIPT_DIR/packages/api && npx @yume-chan/fetch-scrcpy-server 3.1
# cd $SCRIPT_DIR/packages/ui &&  ./patch.sh && pnpm run build

# Start Caddy server with specific configuration
cd $SCRIPT_DIR && chmod +x ./adb_connect.sh && chmod +x ./caddy && ./caddy run --config ./Caddyfile-dev & 

# Run the build-and-start script in the background using pnpm
cd $SCRIPT_DIR/packages/api && pnpm run dev & 

# Change to the UI directory and force run Vite
cd "$SCRIPT_DIR/packages/ui" && npx vite --force & 

# 等待所有後臺進程結束
wait