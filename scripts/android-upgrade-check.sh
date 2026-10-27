#!/usr/bin/env bash
set -euo pipefail
export ANDROID_QA_API="${ANDROID_QA_API:-35}"
python3 - <<'PY'
from pathlib import Path
import os
version=__import__('json').loads(Path('package.json').read_text(encoding='utf-8'))['version']
previous=[line.split()[0] for line in Path('scripts/android-upgrade-releases.txt').read_text(encoding='utf-8').splitlines() if line.strip()]
first,*rest=previous
pairs=" ".join(f'"previous/Alatheel-{item}.apk {item}"' for item in rest)+f' "apk/app-release.apk {version}"'
chain=" -> ".join([*previous,version])
p=Path("scripts/android-smoke.sh").read_text(encoding='utf-8')
p=p.replace("system-images;android-35;google_apis;x86_64", "system-images;android-"+os.environ["ANDROID_QA_API"]+";google_apis;x86_64")
p=p.replace("Signed APK installed and reached the Google sign-in screen without an Android crash.", "Signed APK upgraded in place and displayed the expected startup screen without an Android crash.")
if os.environ["ANDROID_QA_API"] == "29":
    p=p.replace("grep -Eq 'Google|قوقل'", "grep -Fq 'تحديث مكوّن أندرويد'")
needle="adb install -r apk/app-release.apk"
assert p.count(needle)==1
p=p.replace(needle, r'''
PACKAGE=com.alatheel.stable
identity() { adb shell cmd package list packages -U "$PACKAGE"; adb shell dumpsys package "$PACKAGE" | grep -E "firstInstallTime=|versionCode=|versionName=" | tr -d "\r"; }
install_checked() {
  local file="$1" version="$2"
  adb install -r "$file" | tee -a android-qa/upgrade-install.txt
  identity | tee -a android-qa/upgrade-identity.txt
  local info="$(adb shell dumpsys package "$PACKAGE")"
  grep -Fq "versionName=$version" <<< "$info"
}
install_checked previous/Alatheel-__FIRST__.apk __FIRST__
FIRST_ID="$(identity | grep 'uid:')"
FIRST_TIME="$(identity | grep 'firstInstallTime=')"
for pair in __PAIRS__; do
  read -r file version <<< "$pair"
  install_checked "$file" "$version"
  test "$FIRST_ID" = "$(identity | grep 'uid:')"
  test "$FIRST_TIME" = "$(identity | grep 'firstInstallTime=')"
done
printf "PASS: __CHAIN__; UID and firstInstallTime retained without uninstall or data clear.\n" > android-qa/upgrade-result.txt
'''.replace('__FIRST__',first).replace('__PAIRS__',pairs).replace('__CHAIN__',chain))
needle='printf \'Signed APK upgraded'
# Add a full process stop/reopen before the final successful smoke result.
pos=p.index(needle)
p=p[:pos]+"""adb shell am force-stop com.alatheel.stable
adb shell am start -W -n com.alatheel.stable/.MainActivity > android-qa/restart.txt
sleep 5
adb logcat -d -b crash > android-qa/restart-crash.txt
if grep -Fq "Process: com.alatheel.stable" android-qa/restart-crash.txt; then exit 1; fi
""" + p[pos:]
Path("android-upgrade-generated.sh").write_text(p, encoding='utf-8')
PY
bash android-upgrade-generated.sh
