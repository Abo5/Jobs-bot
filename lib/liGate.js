// قاطع دوائر لنكدإن (429 Too Many Requests) — مشترك بين مصدري لنكدإن:
// sources/linkedin.js (الكلمات) و sources/entityJobs.js (الجهات).
//
// ليش: لنكدإن "يكتم" مؤقتاً (حظر مؤقت، دقائق إلى ساعة) إذا كثرت الطلبات. المطلوب
// أن يكون هذا الحظر غير مؤثّر إطلاقاً في جلب الوظائف من بقية المصادر ولا في
// التشغيلات الجاية:
//
// ١) عزل تلقائي — كل مصدر مُغلَّف بـ try/catch في المسار الرئيسي، ففشل لنكدإن
//    لا يسقط تشغيلة ولا يمنع النشر من المصادر الأخرى. (موجود أصلاً.)
// ٢) قاطع دوائر داخل التشغيلة — إذا تجاوزت الـ429 الصعبة (بعد إعادة المحاولة)
//    العتبة، نوقف كل عمل لنكدإن في هذه التشغيلة فوراً بدل المطرقة عليه: نوفر
//    وقت التشغيلة (كل إعادة محاولة = 25 ثانية) ولا نطيل أمد الحظر.
// ٣) تهدئة عبر التشغيلات — يُكتب موعد انتهاء التهدئة في ملف حالة (.li-cooldown)،
//    وأي تشغيلة تبدأ قبل انتهائها تتخطّى لنكدإن كلياً (مع بقاء بقية المصادر
//    كاملة). تمنع سيناريو "عدة تشغيلات تعويض متتالية" (بعد إقلاع أو انقطاع)
//    من ضرب لنكدإن وهو مكتوم.
//
// الحالة تُحفظ بملف نصي بسيط حتى تصلح عبر عمليات Node المنفصلة (كل تشغيلة
// عملية جديدة) وبلا اعتماديات إضافية.
import fs from 'fs';
import { fileURLToPath } from 'url';

const STATE_FILE = process.env.LI_GATE_STATE_FILE
  || fileURLToPath(new URL('../.li-cooldown', import.meta.url));
const MAX_HITS = Number(process.env.LI_RL_MAX_HITS || 4);              // عتبة 429 الصعبة
const COOLDOWN_MS = Number(process.env.LI_RL_COOLDOWN_MS || 45 * 60 * 1000); // ٤٥ دقيقة

let hits = 0;        // عدّاد الـ429 الصعبة في هذه التشغيلة
let trippedAt = 0;   // وقت القطع داخل التشغيلة (0 = لم يُقطع)

function readState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return typeof raw?.until === 'number' ? raw.until : 0;
  } catch {
    return 0;
  }
}

function writeState(until) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ until }), 'utf8');
  } catch (e) {
    console.warn(`   ⚠️ [liGate] تعذّر حفظ حالة التهدئة: ${e.message}`);
  }
}

/** هل لنكدإن في تهدئة من تشغيلة سابقة؟ تُستدعى في بداية كل مصدر من مصدري لنكدإن. */
export function shouldSkipLinkedin() {
  const until = readState();
  if (Date.now() < until) {
    const mins = Math.ceil((until - Date.now()) / 60000);
    console.log(`   🚦 [liGate] لنكدإن في تهدئة (باقي ~${mins} دقيقة) — نتخطّى مصدر لنكدإن هذه التشغيلة، وبقية المصادر تكمل طبيعي`);
    return true;
  }
  if (until) {
    // انتهت التهدئة — امسح الملف حتى تبدأ العدّادات نظيفة
    try { fs.unlinkSync(STATE_FILE); } catch {}
  }
  return false;
}

/**
 * سجّل 429 صعبة (بعد فشل إعادة المحاولة). يرجع true إذا بلغت العتبة ويجب
 * إيقاف عمل لنكدإن في هذه التشغيلة فوراً.
 */
export function reportLinkedin429() {
  hits++;
  if (hits >= MAX_HITS && !trippedAt) {
    trippedAt = Date.now();
    writeState(Date.now() + COOLDOWN_MS);
    console.warn(`   🚦 [liGate] ${hits} استجابة 429 متتالية — قطعنا عمل لنكدإن في هذه التشغيلة وبدأنا تهدئة ${COOLDOWN_MS / 60000} دقيقة (لن يؤثر على بقية المصادر)`);
    return true;
  }
  return false;
}

/** هل انقطع لنكدإن في هذه التشغيلة؟ */
export function isTripped() {
  return trippedAt !== 0;
}
