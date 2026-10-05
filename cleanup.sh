#!/bin/bash
# يحذف بيانات الأيام الفائتة (بتوقيت الرياض): مخرجات التشغيلات اليومية ولقطات الحظر.
# آمن للتشغيل بأي وقت وأكثر من مرة: يحذف فقط ما عُدِّل قبل منتصف ليل الرياض اليوم،
# فلو كان الجهاز مطفياً عند منتصف الليل تنحذف بأول تشغيلة بعدها.
#
# لا نلمس seen-jobs.json ولا posted-jobs.json: هذي ذاكرة منع التكرار — حذفها يخلّي
# البوت يعيد نشر وظائف نُشرت أمس (النافذة متدحرجة ٢٤ ساعة). تتقلّم ذاتياً.
set -e
cd "$(dirname "$(readlink -f "$0")")"

DAY_START=$(TZ=Asia/Riyadh date -d "$(TZ=Asia/Riyadh date +%F) 00:00" +%s)

deleted=0
for f in jobs-*.json api-jobs-*.json job-links-*.txt blocked-*.png; do
  [ -f "$f" ] || continue
  [ "$(stat -c %Y "$f")" -lt "$DAY_START" ] || continue
  rm -f -- "$f"
  deleted=$((deleted + 1))
done

if [ "$deleted" -gt 0 ]; then
  echo "🧹 $(TZ=Asia/Riyadh date '+%Y-%m-%d %H:%M') — حُذف $deleted ملف من بيانات الأيام الفائتة"
fi
