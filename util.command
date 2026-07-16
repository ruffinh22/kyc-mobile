adb reverse tcp:8081 tcp:8081 && adb reverse tcp:3001 tcp:3001 && adb reverse tcp:3000 tcp:3000 && adb devices
npx react-native run-android --deviceId 147334057F001156

npx react-native start --host 0.0.0.0 --port 8081

  ls -la .expo && echo '---' && cat .expo/.virtual-metro-entry.js && echo '---' && pkill -f 'react-native start' || true && pkill -f 'metro' || true && npx react-native start --host 0.0.0.0 --port 8081 --reset-cache