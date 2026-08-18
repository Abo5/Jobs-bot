// قناة الأدمن: تقرير بعد كل تشغيلة + تنبيه فوري عند أي عطل.
// منفصلة عن قناة الوظائف (TELEGRAM_CHAT_ID) — الأدمن يشوف التشخيص، والقناة
// تشوف الوظائف فقط.
//
// سياسة الفشل: أي خطأ هنا يُبتلع ويُطبع في السجل فقط. تنبيه الأدمن ما يجوز
// أبداً يُسقط تشغيلة ناجحة.
import axios from 'axios';
import { config as dateWindowConfig } from './dateWindow.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;

const RIYADH = { timeZone: 'Asia/Riyadh', hour12: false };

function riyadhStamp() {
  const d = new Date();
  const date = d.toLocaleDateString('en-CA', RIYADH);            // YYYY-MM-DD
  const time = d.toLocaleTimeString('en-GB', RIYADH);            // HH:MM:SS
  return `${date} ${time.slice(0, 5)}`;
}

async function send(text) {
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) return false;
  try {
    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      { chat_id: ADMIN_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true },
      { timeout: 20000 }
    );
    return true;
  } catch (e) {
    const why = e.response?.data?.description || e.message;
    console.warn(`⚠️ تنبيه الأدمن فشل: ${why}`);
    return false;
  }
}

/**
 * المعايير التي تمرّ بها كل وظيفة قبل الإرسال.
 * ملاحظة مقصودة: لا نذكر الكلمات المفتاحية — الأدمن يريد المعايير لا قائمة البحث.
 */
function criteriaBlock() {
  const freshness = dateWindowConfig.WINDOW_HOURS > 0
    ? `نُشرت خلال آخر ${dateWindowConfig.WINDOW_HOURS} ساعة (نافذة متدحرجة)`
    : `نُشرت خلال آخر ${dateWindowConfig.WINDOW_DAYS} يوم`;
  const unknown = dateWindowConfig.DROP_UNKNOWN
    ? 'الإعلان بلا تاريخ منشور يُرفض'
    : 'الإعلان بلا تاريخ منشور يُقبل';

  return [
    '<b>المعايير المطبَّقة على كل وظيفة:</b>',
    '',
    '<b>١) الفئة</b> — واحدة من ست:',
    '   • ضمان وضبط جودة البرمجيات (اختبار أنظمة ومواقع وتطبيقات)',
    '   • DevOps / SRE / هندسة المنصّات والبنية التحتية',
    '   • الحوسبة السحابية (هندسة · معمارية · إدارة)',
    '   • الأمن السيبراني بكل فروعه — هجومي ودفاعي وحوكمة',
    '   • وظيفة حكومية (استثناء مطلوب — يُثبته الـAI من نص الإعلان)',
    '   • فتح قبول/تسجيل: جامعات (بكالوريوس · دبلوم · تجسير) · منح وابتعاث · تمهير · حملات التوظيف العسكرية والمدنية',
    '',
    '<b>٢) الموقع</b> — داخل السعودية.',
    '',
    `<b>٣) الحداثة</b> — ${freshness}. ${unknown}.`,
    '',
    '<b>٤) عدم التكرار</b> — لم تُرسل سابقاً (مطابقة بالرابط وببصمة المسمّى+الشركة).',
    '',
    '<b>٥) المستبعَد صراحةً:</b>',
    '   • جودة الإنشاءات والمدني والفحص الميداني وفحص المواقع',
    '   • اللحام والفحص غير الإتلافي (NDT)',
    '   • جودة المصانع وخطوط الإنتاج والبترول والبتروكيماويات',
    '   • جودة الأغذية والدواء والمختبرات الكيميائية والطبية',
    '   • السلامة المهنية (HSE) والمعايرة والمساحة',
    '   • أنظمة الجودة المؤسسية (ISO 9001 / QMS)',
    '   • الأمن المادي: الحراسة والدوريات وكاميرات المراقبة والسلامة من الحريق',
    '   • إعلانات التدريب العامة من غير الجهات المُراقَبة',
    '',
    '<b>٦) رابط تقديم صالح</b> — بدون رابط لا تُرسل.',
    '',
    '<b>٧) تحقّق مزدوج + حوكمة الرسائل</b> — فلتر نصي ثم بوابة ذكاء اصطناعي،',
    'ووسم الفئة وكل الحقائق (شركة · موقع · راتب · رابط) تُشتق من البيانات الأصلية',
    'لا من الذكاء الاصطناعي، ووصف المسؤوليات يُكتب بضوابط صارمة (فصحى · مختصر · بلا تلفيق).'
  ].join('\n');
}

/** تقرير ما بعد التشغيلة */
export async function sendRunReport({ sent = 0, alreadyPosted = 0, failed = 0, stats = {}, titles = [] }) {
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) return false;

  const head = sent > 0
    ? `✅ <b>تم إرسال ${sent} وظيفة</b>`
    : '📭 <b>لم تُرسل أي وظيفة هذه التشغيلة</b>';

  const lines = [head, `🕘 ${riyadhStamp()} بتوقيت الرياض`, ''];

  if (sent > 0) {
    lines.push('<b>جميعها مطابقة للمعايير الموضوعة.</b>', '');
    if (titles.length) {
      lines.push('<b>الوظائف المُرسلة:</b>');
      titles.slice(0, 10).forEach((t, i) => lines.push(`   ${i + 1}. ${t}`));
      lines.push('');
    }
  }

  const parts = [];
  if (stats.collected != null) parts.push(`المجموعة من المصادر: ${stats.collected}`);
  if (stats.inScope != null) parts.push(`داخل المجالات: ${stats.inScope}`);
  if (stats.stale != null) parts.push(`مرفوضة لقِدَمها: ${stats.stale}`);
  if (alreadyPosted) parts.push(`سبق إرسالها: ${alreadyPosted}`);
  if (stats.aiRejected) parts.push(`رفضتها بوابة الذكاء الاصطناعي: ${stats.aiRejected}`);
  if (failed) parts.push(`فشل إرسالها: ${failed}`);
  if (parts.length) lines.push('<b>الأرقام:</b>', ...parts.map(p => `   • ${p}`), '');

  lines.push(criteriaBlock());
  return send(lines.join('\n'));
}

/** تنبيه عطل — يُستدعى من أي مسار فشل */
export async function notifyAdminError(context, error) {
  const msg = String(error?.message || error || 'خطأ غير معروف').slice(0, 500);
  return send([
    '🔴 <b>عطل في بوت الوظائف</b>',
    `🕘 ${riyadhStamp()} بتوقيت الرياض`,
    '',
    `<b>الموضع:</b> ${context}`,
    `<b>الخطأ:</b> <code>${msg.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</code>`
  ].join('\n'));
}

export const adminConfigured = Boolean(BOT_TOKEN && ADMIN_CHAT_ID);
