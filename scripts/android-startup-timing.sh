#!/usr/bin/env bash
# Called inside the already running Android35 smoke emulator. No account login.
set -euo pipefail
mkdir -p android-qa/startup
for sample in 1 2 3 4 5; do
  adb shell am force-stop com.alatheel.stable
  adb logcat -c
  adb shell am start -W -n com.alatheel.stable/.MainActivity > "android-qa/startup/cold-$sample-activity.txt"
  FOUND=false
  for attempt in $(seq 1 40); do
    adb logcat -d > "android-qa/startup/cold-$sample.log"
    if grep -q 'AlatheelStartup.*screen-ready' "android-qa/startup/cold-$sample.log"; then FOUND=true; break; fi
    sleep 1
  done
  test "$FOUND" = true
done
for sample in 1 2 3 4 5; do
  adb shell input keyevent KEYCODE_HOME
  sleep 1
  adb logcat -c
  adb shell am start -W -n com.alatheel.stable/.MainActivity > "android-qa/startup/resume-$sample-activity.txt"
  sleep 1
  adb logcat -d > "android-qa/startup/resume-$sample.log"
  # A short resume of the same verified process must not request another check
  # or re-open the loading screen. Activity timing is retained as diagnostics.
  if grep -Eq 'AlatheelUpdater.*Metadata check requested|AlatheelStartup.*screen-ready' "android-qa/startup/resume-$sample.log"; then
    cat "android-qa/startup/resume-$sample.log"; exit 1
  fi
done
python3 - <<'PY'
import json, re, statistics
from pathlib import Path
values=[]
for file in sorted(Path('android-qa/startup').glob('cold-*.log')):
    match=re.search(r'AlatheelStartup.*?(\{"event":"screen-ready"[^\n]*?\})', file.read_text(errors='replace'))
    assert match, file
    marker=json.loads(match[1])
    assert marker['screen']=='sign-in', marker
    values.append(marker['elapsedMs'])
assert len(values)==5
result={'scope':'Android35 emulator, actual signed APK; WebView navigation to verified Google entry, without signing into a real account',
        'coldMs':values,'medianMs':statistics.median(values),'maxMs':max(values),
        'warmResumesWithoutRepeatedGate':5,
        'limitations':'Does not include Android process creation before WebView navigation and does not measure account data or the user phone.'}
Path('android-qa/startup/timing.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
PY
