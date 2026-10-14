#!/bin/bash
# Build 语音唤醒 GrokBot (wake word "Waterly") (macOS 14+, arm64). Usage: native/mac/grokcall/build.sh [test]
set -e; cd "$(dirname "$0")"; mkdir -p build
if [ "$1" = test ]; then swiftc GrokCallCore.swift tests/main.swift -o build/core-tests && build/core-tests; exit; fi
APP=build/GrokBotWake.app
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS"
swiftc -O -target arm64-apple-macos14 GrokCallCore.swift main.swift -o "$APP/Contents/MacOS/GrokBotWake" \
  -framework AppKit -framework ApplicationServices -framework Speech -framework AVFoundation -framework Vision -framework ScreenCaptureKit
cp Info.plist "$APP/Contents/Info.plist"
mkdir -p "$APP/Contents/Resources" && cp grokcall_button.png "$APP/Contents/Resources/"
# ad-hoc sign with a stable designated requirement so TCC grants survive rebuilds
codesign --force --sign - --requirements '=designated => identifier "com.waterly.grokcall"' "$APP"
echo "built $APP"
