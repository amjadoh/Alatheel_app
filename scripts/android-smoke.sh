#!/usr/bin/env bash
set -euo pipefail
mkdir -p android-qa
cat /etc/resolv.conf > android-qa/host-dns.txt
curl --fail --silent --show-error --max-time 30 https://alatheel-app-426403695200.web.app/latest.json > android-qa/public-update.json
getent ahostsv4 alatheel-app-426403695200.web.app > android-qa/host-addresses.txt
test -e /dev/kvm
sudo chmod 666 /dev/kvm
# Keep avdmanager and emulator on the same explicit configuration directory.
# https://developer.android.com/tools/variables
export ANDROID_USER_HOME="$RUNNER_TEMP/alatheel-android-user"
export ANDROID_EMULATOR_HOME="$ANDROID_USER_HOME"
export ANDROID_AVD_HOME="$ANDROID_USER_HOME/avd"
mkdir -p "$ANDROID_AVD_HOME"
echo no | avdmanager create avd --force --name alatheel-qa --package 'system-images;android-35;google_apis;x86_64' --path "$ANDROID_AVD_HOME/alatheel-qa.avd"
test -s "$ANDROID_AVD_HOME/alatheel-qa.ini"
test -x "$ANDROID_HOME/emulator/emulator"
"$ANDROID_HOME/emulator/emulator" -list-avds | grep -Fx alatheel-qa
"$ANDROID_HOME/emulator/emulator" -avd alatheel-qa -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect -dns-server 8.8.8.8 > android-qa/emulator.log 2>&1 &
EMULATOR_PID=$!
trap 'kill "$EMULATOR_PID" 2>/dev/null || true' EXIT
CONNECTED=false
for i in $(seq 1 120); do
  if ! kill -0 "$EMULATOR_PID" 2>/dev/null; then cat android-qa/emulator.log; exit 1; fi
  if test "$(adb get-state 2>/dev/null | tr -d '\r')" = device; then CONNECTED=true; break; fi
  sleep 2
done
test "$CONNECTED" = true
BOOTED=false
for i in $(seq 1 120); do
  if test "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1; then BOOTED=true; break; fi
  sleep 2
done
test "$BOOTED" = true
sleep 15
adb shell dumpsys connectivity > android-qa/connectivity.txt
adb shell ping -c 1 -W 5 alatheel-app-426403695200.web.app > android-qa/dns-check.txt 2>&1 || true
adb shell ping -c 1 -W 5 8.8.8.8 > android-qa/ip-check.txt 2>&1 || true
adb shell input keyevent 82
adb shell wm dismiss-keyguard
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0
adb install -r apk/app-release.apk
adb logcat -c
adb shell am start -W -n com.alatheel.stable/.MainActivity > android-qa/start.txt
grep -Fq 'Status: ok' android-qa/start.txt
sleep 12
adb shell dumpsys activity activities > android-qa/activities.txt
grep -E 'mResumedActivity|topResumedActivity' android-qa/activities.txt | grep -Fq com.alatheel.stable
adb shell uiautomator dump /sdcard/alatheel-window.xml
adb pull /sdcard/alatheel-window.xml android-qa/window.xml
adb logcat -d > android-qa/app-log.txt
adb exec-out screencap -p > android-qa/launch.png
adb logcat -d -b crash > android-qa/crash.txt
if grep -Fq 'Process: com.alatheel.stable' android-qa/crash.txt; then cat android-qa/crash.txt; exit 1; fi
grep -Fq 'com.alatheel.stable' android-qa/window.xml
if grep -Fq 'تعذر التحقق' android-qa/window.xml; then cat android-qa/dns-check.txt android-qa/ip-check.txt android-qa/host-dns.txt; grep -E -A 8 'AlatheelUpdater|UnknownHost|DnsResolver|SSL|Network is unreachable' android-qa/app-log.txt || true; exit 1; fi
grep -Eq 'Google|قوقل' android-qa/window.xml
printf 'Signed APK installed and reached the Google sign-in screen without an Android crash. Authentication was not attempted.\n' > android-qa/result.txt

