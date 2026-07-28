// فلترة زمنية صارمة: نقبل فقط وظائف "اليوم + أمس" (يومين تقويميين).
// مثال: لو التشغيل يوم 30 -> نقبل 29 و30 فقط. قابل للضبط عبر DATE_WINDOW_DAYS.
//
// يدعم صيغ التاريخ المختلفة القادمة من المصادر:
//   - ISO كامل: 2026-07-19T08:21:47.000Z  /  2026-07-19T15:03:41+03:00
//   - تاريخ فقط: 2026-07-19
//   - نسبي إنجليزي: today, yesterday, 2 days ago, 3 hours ago, 1 week ago
//   - نسبي عربي: اليوم، أمس، البارحة، قبل يومين، منذ 3 أيام، منذ ساعة، الآن
//   - unknown / فاضي -> غير معروف (سياسته حسب DROP_UNKNOWN_DATES)

const WINDOW_DAYS = Number(process.env.DATE_WINDOW_DAYS || 2);       // اليوم + أمس
const DROP_UNKNOWN = String(process.env.DROP_UNKNOWN_DATES || 'false').toLowerCase() === 'true';
const RIYADH_OFFSET_MS = 3 * 3600 * 1000;                            // UTC+3 (بلا صيف)

// رقم اليوم التقويمي بتوقيت الرياض (يوحّد المقارنة بين ISO-UTC والتواريخ المجردة)
function riyadhDayIndex(ms) {
  return Math.floor((ms + RIYADH_OFFSET_MS) / 86400000);
}

// أرقام عربية/هندية -> لاتينية
function normalizeDigits(s) {
  const ar = '٠١٢٣٤٥٦٧٨٩', fa = '۰۱۲۳۴۵۶۷۸۹';
  return String(s).replace(/[٠-٩۰-۹]/g, d => {
    const i = ar.indexOf(d); return i > -1 ? i : fa.indexOf(d);
  });
}

// يرجّع daysAgo (0 = اليوم، 1 = أمس ...) أو null إذا التاريخ غير معروف
export function daysAgoOf(value, nowMs = Date.now()) {
  if (value == null) return null;
  const raw = normalizeDigits(String(value)).trim();
  const s = raw.toLowerCase();
  if (!s || s === 'unknown' || s === 'n/a' || s === 'غير محدد' || s === 'غير معروف') return null;

  const todayIdx = riyadhDayIndex(nowMs);

  // ملاحظة: \b لا يعمل حول الحروف العربية (ليست \w)، فنستخدم مطابقة نصية مباشرة للعربي.
  // نسبي: اليوم / الآن / منذ دقائق أو ساعات => daysAgo = 0
  if (/(^|\W)(today|now|just now)(\W|$)/.test(s) || /\b(minute|hour)s?\b/.test(s) ||
      /اليوم|الآن|الان|للتو|توّ|قبل قليل|دقيقة|دقائق|ساعة|ساعتين|ساعات/.test(s)) return 0;
  if (/\byesterday\b/.test(s) || /أمس|امس|البارحة/.test(s)) return 1;

  // "X day(s) ago" / "منذ X يوم" / "قبل X أيام"
  let m = s.match(/(\d+)\s*(day|days|يوم|أيام|ايام)/);
  if (m) return Number(m[1]);
  if (/يومين/.test(s)) return 2;
  // أسابيع / شهور => خارج النافذة حتماً (نرجّع رقم كبير)
  m = s.match(/(\d+)\s*(week|weeks|أسبوع|أسابيع|اسبوع)/);
  if (m) return Number(m[1]) * 7;
  if (/أسبوعين|اسبوعين/.test(s)) return 14;
  if (/\bweek\b/.test(s) || /أسبوع|اسبوع/.test(s)) return 7;
  m = s.match(/(\d+)\s*(month|months|شهر|أشهر|اشهر)/);
  if (m) return Number(m[1]) * 30;
  if (/\b(month|year)\b/.test(s) || /شهر|شهرين|سنة|عام/.test(s)) return 30;

  // مطلق: نحاول Date.parse
  const t = Date.parse(raw);
  if (!Number.isNaN(t)) return todayIdx - riyadhDayIndex(t);

  // تاريخ فقط بصيغة YYYY-MM-DD ما التقطها Date.parse لأي سبب
  m = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const t2 = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return todayIdx - riyadhDayIndex(t2);
  }
  return null; // غير معروف
}

/**
 * هل الوظيفة داخل النافذة المسموحة (اليوم + أمس)؟
 * - تاريخ معروف: يُقبل فقط إذا daysAgo ضمن [-1 .. WINDOW_DAYS-1]
 *   (نسمح -1 لتفادي فروق التوقيت التي تجعل الوقت يبدو "غداً").
 * - تاريخ غير معروف: يُقبل إلا إذا DROP_UNKNOWN_DATES=true.
 */
export function isWithinWindow(value, nowMs = Date.now()) {
  const d = daysAgoOf(value, nowMs);
  if (d === null) return !DROP_UNKNOWN;
  return d >= -1 && d <= WINDOW_DAYS - 1;
}

export const config = { WINDOW_DAYS, DROP_UNKNOWN };
