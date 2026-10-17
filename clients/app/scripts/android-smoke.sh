#!/usr/bin/env bash
# Smoke test for the Android app on an emulator: launch, open Mail, turn the phone, go back and
# reopen. Fails if the app crashes or stops responding at any step. Leaves a screenshot, the
# screen's text (uiautomator dump) and the log for each step in the output folder.
#
# Usage: scripts/android-smoke.sh <apk> <output folder>
set -u
apk=$1
out=$2
pkg=cloud.synergytech.suite
mkdir -p "$out"
fail=0

adb install -r "$apk" || exit 1
adb logcat -c

shot() {
  adb exec-out screencap -p > "$out/$1.png"
  if timeout 30 adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1; then
    adb pull /sdcard/ui.xml "$out/$1.xml" > /dev/null 2>&1
  else
    echo "<hierarchy/>" > "$out/$1.xml"
  fi
  echo "== $1: text on screen"
  grep -o 'text="[^"]\+"' "$out/$1.xml" | sed 's/^text="//; s/"$//' | head -40
}

check() {
  if ! adb shell pidof "$pkg" > /dev/null; then
    echo "::error::Synergy is no longer running after: $1"
    fail=1
  fi
  if adb logcat -d | grep -q "ANR in $pkg"; then
    echo "::error::Synergy stopped responding after: $1"
    fail=1
  fi
}

# The center of the first element whose text ends with $2 in dump $1 (tiles read "M Mail").
center() {
  grep -o "text=\"[^\"]*$2\"[^>]*bounds=\"[^\"]*\"" "$out/$1.xml" | head -1 |
    sed -E 's/.*bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]".*/\1 \2 \3 \4/' |
    awk '{ print int(($1 + $3) / 2), int(($2 + $4) / 2) }'
}

# A tap and a short wait give Android the input it needs to notice a frozen app.
poke() {
  adb shell input swipe 160 420 160 260 200
  sleep 10
}

adb shell monkey -p "$pkg" -c android.intent.category.LAUNCHER 1 > /dev/null
sleep 25
shot 1-launch
poke
check "launch"
pid=$(adb shell pidof "$pkg")

xy=$(center 1-launch Mail)
if [ -n "$xy" ]; then
  adb shell input tap $xy
  sleep 30
  shot 2-mail
  poke
  check "opening Mail"
else
  echo "::warning::No Mail button on the launcher screen"
fi

adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 1
sleep 10
shot 3-landscape
poke
check "turning the phone"
adb shell settings put system user_rotation 0
sleep 5

adb shell input keyevent KEYCODE_BACK
sleep 5
adb shell input keyevent KEYCODE_HOME
sleep 3
adb shell monkey -p "$pkg" -c android.intent.category.LAUNCHER 1 > /dev/null
sleep 20
shot 4-reopen
poke
check "going back and reopening"
if [ "$(adb shell pidof "$pkg")" != "$pid" ]; then
  echo "::error::Synergy restarted: it closed or crashed while in the background"
  fail=1
fi

adb logcat -d > "$out/logcat.txt"
echo "== Problems in the log"
grep -E "FATAL EXCEPTION|panicked|ANR in|FORTIFY|Fatal signal" "$out/logcat.txt" | head -60
if grep -E "FATAL EXCEPTION|panicked at|FORTIFY|Fatal signal" "$out/logcat.txt" | grep -qv UiAutomation; then
  echo "::error::Synergy crashed; see logcat.txt in the synergy-android-smoke artifact"
  fail=1
fi
exit $fail
