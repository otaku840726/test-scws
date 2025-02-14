#!/bin/bash

# 獲取環境變量
IFS=',' read -r -a devices <<< "$ADB_DEVICES"

# 設置超時秒數
TIMEOUT=2

# 檢查設備是否已連接
check_device_connection() {
    local device=$1
    adb devices | grep -q "$device"
}

# 檢查設備是否能正常響應
check_device_response() {
    local device=$1
    timeout $TIMEOUT adb -s "$device" shell getprop ro.build.version.release
}

# 重新連接設備
reconnect_device() {
    local device=$1
    adb disconnect "$device"
    adb connect "$device"
}

# 測試每個設備的連線狀況
for device in "${devices[@]}"
do
    if check_device_connection "$device"; then
        response=$(check_device_response "$device")
        if [ -n "$response" ]; then
            echo "$device 回應正常: Android版本 $response"
        else
            echo "$device 未正常回應，嘗試重新連線..."
            reconnect_device "$device"
            response=$(check_device_response "$device")
            if [ -n "$response" ]; then
                echo "$device 重新連線成功: Android版本 $response"
            else
                echo "$device 重新連線失敗"
            fi
        fi
    else
        echo "$device 未連接，嘗試重新連線..."
        reconnect_device "$device"
        if check_device_connection "$device"; then
            response=$(check_device_response "$device")
            if [ -n "$response" ]; then
                echo "$device 重新連線成功: Android版本 $response"
            else
                echo "$device 重新連線失敗後仍未正常回應"
            fi
        else
            echo "$device 重新連線失敗"
        fi
    fi
done