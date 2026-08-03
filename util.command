adb reverse tcp:8081 tcp:8081 && adb reverse tcp:3001 tcp:3001 && adb reverse tcp:3000 tcp:3000 && adb devices
npx react-native run-android --deviceId 147334057F001156

npx react-native start --host 0.0.0.0 --port 8081

  ls -la .expo && echo '---' && cat .expo/.virtual-metro-entry.js && echo '---' && pkill -f 'react-native start' || true && pkill -f 'metro' || true && npx react-native start --host 0.0.0.0 --port 8081 --reset-cache

   
  find android/app/build/outputs/apk -name '*.apk' -type f -printf '%f %s bytes\n' | sort
adb install -r android/app/build/outputs/apk/debug/kyc-mobile-1.0.0-debug-arm64-v8a.apk
curl -s -X POST http://127.0.0.1:3001/api/call/test -H 'Content-Type: application/json' -d '{"numero":"0167376539","numeroMtn":"0700000000"}'

cd /home/lidruf/kyc-mobile/kyc-modern/backend && echo 'FCM vars:' && env | grep -E 'FCM|GOOGLE' | sed 's/=.*$/=<set>/' || true && echo '---' && curl -s -X POST http://127.0.0.1:3001/api/call/test -H 'Content-Type: application/json' -d '{"numero":"0167376539","numeroMtn":"0700000000"}'
