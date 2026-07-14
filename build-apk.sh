#!/bin/bash

# Configuration Android
export ANDROID_SDK_ROOT=/home/lidruf/Android/Sdk
export PATH=$PATH:$ANDROID_SDK_ROOT/platform-tools
export PATH=$PATH:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin

# Compiler APK debug
cd /home/lidruf/kyc-mobile/android
./gradlew assembleDebug --no-daemon "$@"

echo ""
echo "✅ APK générée : android/app/build/outputs/apk/debug/app-debug.apk"
