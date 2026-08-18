#!/bin/bash
# يشغّل السكربت مرة وحدة بس (يمنع التداخل لو تشغيلة سابقة لسا شغالة)
set -e
cd "$(dirname "$(readlink -f "$0")")"

# ===== بوابة التوقيت: التشغيل بتوقيت الرياض فقط =====
# ليش هنا مو في cron: نسخة Debian من cron ما تدعم توقيتاً مستقلاً للجدول
# (لا CRON_TZ ولا توقيت لكل مستخدم — صفحة `man 5 crontab` تقولها صراحة وتنصح
# بفحص الوقت داخل السكربت). وتوقيت هذا الجهاز America/New_York فيه توقيت صيفي،
# فلو حطينا الساعات محوّلة يدوياً في cron كانت بتنزاح ساعة كاملة عند تغيير
# التوقيت الصيفي/الشتوي — والرياض ما عندها توقيت صيفي.
#
# الحل: cron ينده كل ساعة، وهذي البوابة تخرج بصمت إلا في ساعات الرياض المطلوبة.
# ملاحظة: فرق الرياض ونيويورك ساعات كاملة، فدقيقة :00 وحدة عند الاثنين.
#
# ===== تعويض التشغيلات الفائتة (إجباري) =====
# الموعد ما يُلغى أبداً: لو فات (الجهاز مطفي · محمّل · تشغيلة سابقة ماسكة القفل ·
# البوت طاح) يظل "مستحقاً" ويشتغل بأول ساعة جاية، ويعيد المحاولة كل ساعة لين ينجح.
# الموعد ما يُشطب إلا بعد تشغيلة ناجحة فعلاً (exit 0).
# كل ساعتين (١٢ مرة يومياً) — البوت "منعش": أي وظيفة جديدة تظهر في القناة خلال
# ساعتين من نشرها بدل ثلاث. الحماية من حظر لنكدإن ما تجي من تقليل التشغيلات بل من
# تدوير الكلمات والجهات داخل السكربت (KEYWORD_SLICE / ENTITY_SLICE): كل تشغيلة
# تبحث شريحة أصغر (٨ كلمات · ٦ جهات)، فالحِمل اليومي على لنكدإن بقي ٩٦ استدعاء
# كما كان تماماً، مع قاطع دوائر 429 (lib/liGate.js) يجمّد لنكدإن مؤقتاً إذا حُظر
# — فلا يعيق أبداً بقية المصادر ولا التشغيلات الجاية.
RUN_HOURS="${JOBS_RUN_HOURS:-00,02,04,06,08,10,12,14,16,18,20,22}"   # بتوقيت الرياض
SLOT_STATE="${JOBS_SLOT_STATE:-$PWD/.run-slots}"
CATCHUP_WINDOW=${JOBS_CATCHUP_WINDOW:-86400}   # لا نعوّض موعداً أقدم من ٢٤ ساعة

# JOBS_NOW_TEST=<epoch> يزيّف "الآن" — للاختبار فقط، حتى نقدر نفحص التعويض
# بكل السيناريوهات بدون انتظار ساعات حقيقية. cron ما يمرّره أبداً.
NOW=${JOBS_NOW_TEST:-$(date +%s)}
DUE=""
for d in "$(TZ=Asia/Riyadh date -d "@$((NOW - 86400))" +%F)" "$(TZ=Asia/Riyadh date -d "@$NOW" +%F)"; do
  for h in ${RUN_HOURS//,/ }; do
    slot="$d $h"
    ts=$(TZ=Asia/Riyadh date -d "$d $h:00" +%s 2>/dev/null) || continue
    # مستحق = وقته فات، وضمن نافذة التعويض، وما انشطب من قبل
    [ "$ts" -le "$NOW" ] || continue
    [ $((NOW - ts)) -le "$CATCHUP_WINDOW" ] || continue
    grep -qxF "$slot" "$SLOT_STATE" 2>/dev/null && continue
    DUE="$DUE$slot"$'\n'
  done
done

# FORCE_RUN=1 يتجاوز البوابة — للتشغيل اليدوي بأي وقت
if [ "${FORCE_RUN:-0}" != "1" ] && [ -z "$DUE" ]; then
  exit 0
fi

DUE_COUNT=$(printf '%s' "$DUE" | grep -c . || true)
echo "🕘 تشغيل بتوقيت الرياض: $(TZ=Asia/Riyadh date -d "@$NOW" '+%Y-%m-%d %H:%M %Z')"
if [ "$DUE_COUNT" -gt 1 ] || { [ "$DUE_COUNT" = 1 ] && [ "$(printf '%s' "$DUE" | tr -d '\n' | awk '{print $2}')" != "$(TZ=Asia/Riyadh date -d "@$NOW" +%H)" ]; }; then
  echo "♻️ تعويض مواعيد فائتة ($DUE_COUNT): $(printf '%s' "$DUE" | tr '\n' '|' | sed 's/|$//')"
fi

# استخراج node: cron يشتغل بـPATH مُقلَّص (/usr/bin:/bin) وnode هنا تحت nvm.
# ننشد nvm أولاً عمداً: في هذا الجهاز /usr/bin/node = v20 بينما nvm = v22 وهو
# اللي اختُبر عليه البوت. لو اعتمدنا على PATH فقط، cron كان بياخذ v20 بصمت.
find_node() {
  local n
  n=$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)
  if [ -x "$n" ]; then echo "$n"; return; fi
  if command -v node >/dev/null 2>&1; then command -v node; return; fi
  for n in /usr/local/bin/node /usr/bin/node; do
    [ -x "$n" ] && { echo "$n"; return; }
  done
  return 1
}

# تنبيه الأدمن من طبقة الشِل: الأعطال اللي تقع قبل ما يبدأ Node (node مفقود ·
# المهلة تقتل التشغيلة · موعد عالق لساعات) ما توصل عبر lib/adminNotify.js أبداً
# لأن الكود ما اشتغل أصلاً. هذي الشبكة الأخيرة.
notify_admin() {
  local token chat
  token=$(grep -m1 '^TELEGRAM_BOT_TOKEN=' .env 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' \r')
  chat=$(grep -m1 '^TELEGRAM_ADMIN_CHAT_ID=' .env 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' \r')
  [ -n "$token" ] && [ -n "$chat" ] || return 0
  curl -sS -m 20 -o /dev/null \
    --data-urlencode "chat_id=$chat" \
    --data-urlencode "text=🔴 بوت الوظائف — $1
🕘 $(TZ=Asia/Riyadh date '+%Y-%m-%d %H:%M') بتوقيت الرياض" \
    "https://api.telegram.org/bot${token}/sendMessage" || true
}

NODE=$(find_node) || {
  echo "❌ ما لقينا node — عدّل find_node في run.sh" >&2
  notify_admin "تعذّر إيجاد Node — التشغيلة ما بدأت إطلاقاً"
  exit 1
}

# تدوير السجل: بدونه ينمو للأبد ويملأ القرص فيتوقّف البوت. نحتفظ بنسخة سابقة وحدة.
LOG=run.log
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG" 2>/dev/null || echo 0)" -gt $((20*1024*1024)) ]; then
  mv -f "$LOG" "$LOG.1"
  echo "♻️ دوّرنا run.log (تجاوز ٢٠ ميجا) -> run.log.1"
fi

# مهلة قصوى: بدونها تشغيلة معلّقة (سوكِت ميت · واجهة ما ترد) تمسك flock للأبد،
# فكل التشغيلات الجاية تفشل بصمت والبوت يموت وإحنا ما ندري. TERM ثم KILL بعد دقيقة.
MAX_RUNTIME=${JOBS_MAX_RUNTIME:-5400}   # ٩٠ دقيقة
LOCK_FILE=${JOBS_LOCK_FILE:-/tmp/jobs-scraper.lock}   # يُغيَّر للاختبار فقط

status=0
flock -n "$LOCK_FILE" \
  timeout --signal=TERM --kill-after=60 "$MAX_RUNTIME" "$NODE" jobs-scraper-fixed.js || status=$?

# 124 = المهلة انتهت. نميّزها عشان تبان في السجل بدل ما تضيع كرقم غامض.
if [ "$status" = 124 ] || [ "$status" = 137 ]; then
  echo "⏱️ التشغيلة تجاوزت المهلة ($MAX_RUNTIME ثانية) وأُنهيت — القفل تحرّر والموعد باقٍ مستحقاً"
  notify_admin "التشغيلة تجاوزت المهلة ($((MAX_RUNTIME / 60)) دقيقة) وأُنهيت قسراً — الموعد باقٍ مستحقاً وسيعاد"
fi

# موعد عالق: لو أقدم موعد مستحق مضى عليه أكثر من STUCK_AFTER، معناها التشغيلات
# تفشل بالتوالي (قفل محجوز أبداً · تعطّل متكرر) — وهذا لا يُكتشف بغير تنبيه.
STUCK_AFTER=${JOBS_STUCK_AFTER:-21600}   # ٦ ساعات = موعدان فائتان
if [ "$status" != 0 ] && [ -n "$DUE" ]; then
  oldest=$(printf '%s' "$DUE" | head -1)
  oldest_ts=$(TZ=Asia/Riyadh date -d "$(printf '%s' "$oldest" | awk '{print $1, $2":00"}')" +%s 2>/dev/null || echo "$NOW")
  if [ $((NOW - oldest_ts)) -ge "$STUCK_AFTER" ]; then
    notify_admin "موعد عالق منذ $(( (NOW - oldest_ts) / 3600 )) ساعة (منذ $oldest) — التشغيلات تفشل بالتوالي (آخر خروج: $status)"
  fi
fi

# نشطب المواعيد المستحقة فقط لو نجحت التشغيلة. أي فشل (بما فيه القفل محجوز =
# exit 1 من flock) يخلّيها مستحقة، فتعيد المحاولة الساعة الجاية تلقائياً.
if [ "$status" = 0 ] && [ -n "$DUE" ]; then
  printf '%s' "$DUE" >> "$SLOT_STATE"
  tail -n 60 "$SLOT_STATE" > "$SLOT_STATE.tmp" && mv "$SLOT_STATE.tmp" "$SLOT_STATE"
elif [ "$status" != 0 ]; then
  echo "⚠️ التشغيلة فشلت (exit=$status) — الموعد باقٍ مستحقاً وبيعيد المحاولة الساعة الجاية"
fi

exit "$status"
