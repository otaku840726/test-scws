#!/bin/bash

# 下載最新版本的Android SDK平台工具包
wget https://dl.google.com/android/repository/platform-tools-latest-linux.zip

# 解壓縮並移動到適當位置
unzip platform-tools-latest-linux.zip
sudo cp platform-tools/adb /usr/bin/adb

# 確認ADB版本
adb version

echo "ADB安裝完成！"

sudo apt update
sudo apt install -y python3 python3-pip

pip3 install --break-system-packages meson 

cd ~ 

git clone https://github.com/Genymobile/scrcpy.git

cd scrcpy

sudo apt install -y pkg-config

sudo apt install -y libavformat-dev

sudo apt install -y libsdl2-dev

sudo apt install -y ffmpeg libsdl2-2.0-0 adb libusb-1.0-0

sudo apt install -y gcc git pkg-config meson ninja-build libsdl2-dev \
                 libavcodec-dev libavdevice-dev libavformat-dev libavutil-dev \
                 libswresample-dev libusb-1.0-0-dev

./install_release.sh

cd ~/scws

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -

sudo apt-get install -y nodejs

sudo apt install -y  npm

sudo npm install -g pnpm

pnpm recursive install


