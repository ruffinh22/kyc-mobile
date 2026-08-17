adb reverse tcp:8081 tcp:8081 && adb reverse tcp:3001 tcp:3001 && adb reverse tcp:3000 tcp:3000 && adb devices
npx react-native run-android --deviceId 147334057F001156

npx react-native start --host 0.0.0.0 --port 8081

  ls -la .expo && echo '---' && cat .expo/.virtual-metro-entry.js && echo '---' && pkill -f 'react-native start' || true && pkill -f 'metro' || true && npx react-native start --host 0.0.0.0 --port 8081 --reset-cache

   
  find android/app/build/outputs/apk -name '*.apk' -type f -printf '%f %s bytes\n' | sort
adb install -r android/app/build/outputs/apk/debug/kyc-mobile-1.0.0-debug-arm64-v8a.apk
curl -s -X POST http://127.0.0.1:3001/api/call/test -H 'Content-Type: application/json' -d '{"numero":"0167376539","numeroMtn":"0700000000"}'

cd /home/lidruf/kyc-mobile/kyc-modern/backend && echo 'FCM vars:' && env | grep -E 'FCM|GOOGLE' | sed 's/=.*$/=<set>/' || true && echo '---' && curl -s -X POST http://127.0.0.1:3001/api/call/test -H 'Content-Type: application/json' -d '{"numero":"0167376539","numeroMtn":"0700000000"}'



export DB_HOST=... DB_USER=... DB_PASS=... DB_NAME=...
export FORCE_MIGRATIONS_CONFIRM=1
yarn migrate:force --name=20260815_add_unknown_referentiel_gsm



curl -X POST -H "Authorization: Bearer $TOKEN" "http://localhost:3001/api/admin/unknown-referentiels/123/ignore"




export DB_HOST=127.0.0.1
export DB_PORT=3306
export DB_USER=kyc_user
export DB_PASS='Genereux@55'
export DB_NAME=kyc_prod
export FORCE_MIGRATIONS_CONFIRM=1
yarn migrate:force --name=20260814_add_dispo_seq


DB_USER=kyc_user
DB_PASS=Genereux@55
DB_NAME=kyc_prod

FORCE_MIGRATIONS_CONFIRM=1 \
DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=kyc_user DB_PASS='Genereux@55'' DB_NAME=kyc_v4 \
yarn migrate:force --name=20260814_add_dispo_seq


