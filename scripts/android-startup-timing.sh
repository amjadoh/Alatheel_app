#!/usr/bin/env bash
# Signed releases disable WebView console forwarding; verify actual visible UI.
set -euo pipefail
mkdir -p android-qa/startup
screen_ready() {
  python3 - "$1" <<'PY'
import re, sys, xml.etree.ElementTree as ET
try:
    nodes=list(ET.parse(sys.argv[1]).getroot().iter('node'))
    if any(any(word in n.get('text','') for word in ['جارٍ فتح الأثيل', 'تعذر إكمال الفتح', 'تعذر التحقق', 'حدّث التطبيق للمتابعة']) for n in nodes):
        sys.exit(1)
    screen=list(map(int,re.findall(r'\d+',nodes[0].get('bounds',''))))
    for node in nodes:
        if node.get('package')!='com.alatheel.stable' or node.get('class')!='android.widget.Button': continue
        if node.get('text') not in ['دخول الأعضاء', 'دخول الأعضاء باستخدام Google']: continue
        if node.get('enabled')!='true' or node.get('clickable')!='true': continue
        r=list(map(int,re.findall(r'\d+',node.get('bounds',''))))
        if len(r)==len(screen)==4 and r[2]>r[0] and r[3]>r[1] and r[0]>=screen[0] and r[1]>=screen[1] and r[2]<=screen[2] and r[3]<=screen[3]: sys.exit(0)
except (OSError,ET.ParseError,IndexError):
    pass
sys.exit(1)
PY
}
wait_ready() {
  local label="$1" deadline=$((SECONDS+60))
  while test "$SECONDS" -lt "$deadline"; do
    adb logcat -d -b crash > "android-qa/startup/$label-crash.txt"
    if grep -Fq 'Process: com.alatheel.stable' "android-qa/startup/$label-crash.txt"; then return 1; fi
    adb shell rm -f /sdcard/alatheel-startup.xml
    if timeout 10 adb shell uiautomator dump /sdcard/alatheel-startup.xml >/dev/null &&
       timeout 5 adb pull /sdcard/alatheel-startup.xml "android-qa/startup/$label.xml" >/dev/null 2>&1 &&
       screen_ready "android-qa/startup/$label.xml"; then return 0; fi
    sleep 1
  done
  return 1
}
for sample in 1 2 3 4 5; do
  adb shell am force-stop com.alatheel.stable
  # Android may acknowledge force-stop before the old process has fully exited.
  # Starting during that window can make ActivityManager cancel the new process.
  STOPPED=false
  for attempt in $(seq 1 60); do
    if ! adb shell pidof com.alatheel.stable >/dev/null 2>&1; then STOPPED=true; break; fi
    sleep 0.25
  done
  test "$STOPPED" = true
  adb logcat -c
  STARTED=$(date +%s%3N)
  adb shell am start -W -n com.alatheel.stable/.MainActivity > "android-qa/startup/cold-$sample-activity.txt"
  wait_ready "cold-$sample"
  FINISHED=$(date +%s%3N)
  printf '%s\n' "$((FINISHED-STARTED))" > "android-qa/startup/cold-$sample-upper-bound-ms.txt"
  adb logcat -d > "android-qa/startup/cold-$sample.log"
  grep -Fq 'AlatheelUpdater: Metadata check requested' "android-qa/startup/cold-$sample.log"
done
PROCESS_ID=$(adb shell pidof com.alatheel.stable | tr -d '\r')
test -n "$PROCESS_ID"
for sample in 1 2 3 4 5; do
  adb shell input keyevent KEYCODE_HOME
  sleep 1
  adb logcat -c
  adb shell am start -W -n com.alatheel.stable/.MainActivity > "android-qa/startup/resume-$sample-activity.txt"
  wait_ready "resume-$sample"
  test "$PROCESS_ID" = "$(adb shell pidof com.alatheel.stable | tr -d '\r')"
  sleep 1
  adb logcat -d > "android-qa/startup/resume-$sample.log"
  if grep -Fq 'AlatheelUpdater: Metadata check requested' "android-qa/startup/resume-$sample.log"; then
    cat "android-qa/startup/resume-$sample.log"; exit 1
  fi
done
python3 - <<'PY'
import json, re, statistics
from pathlib import Path
folder=Path('android-qa/startup')
upper=[int(p.read_text()) for p in sorted(folder.glob('cold-*-upper-bound-ms.txt'))]
activity=[]
for file in sorted(folder.glob('cold-*-activity.txt')):
    match=re.search(r'^TotalTime:\s*(\d+)',file.read_text(),re.M)
    assert match,file
    activity.append(int(match[1]))
assert len(upper)==len(activity)==5
result={'scope':'Android35 emulator; signed APK; process launch to visibly actionable member sign-in entry, without account authentication',
        'visibleEntryUpperBoundMs':upper,'medianUpperBoundMs':statistics.median(upper),'activityTotalTimeMs':activity,
        'warmResumesInSameProcessWithoutMetadataRecheck':5,
        'limitations':'The upper bound includes adb and accessibility polling overhead. Activity time is separate. Neither measures a real account session or the user phone.'}
(folder/'timing.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
PY
