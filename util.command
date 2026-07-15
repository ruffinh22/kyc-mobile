adb reverse tcp:8081 tcp:8081 && adb reverse tcp:3001 tcp:3001 && adb reverse tcp:3000 tcp:3000 && adb devices
npx react-native run-android --deviceId 147334057F001156

npx react-native start --host 0.0.0.0 --port 8081