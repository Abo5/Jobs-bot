// هوية موحّدة للوظيفة لكشف التكرار بقوة — طبقتان:
//  1) تطبيع الرابط: يمسك نفس الإعلان بروابط شكلها مختلف (www/sa/arabic، بارامترات، /).
//  2) بصمة المحتوى: يمسك نفس الوظيفة معادة النشر عبر مصادر مختلفة (linkedin + bayt + naukrigulf)
//     حتى لو اختلف الرابط تماماً — عبر (المسمى + الشركة + المدينة) بعد تطبيع عربي.

// تطبيع النص العربي: إزالة التشكيل وتوحيد الألف/الهمزة/التاء المربوطة/الياء
function arabicNormalize(s) {
  return String(s || '')
    .replace(/[ً-ْٰ]/g, '')      // تشكيل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ـ/g, '');                          // تطويل
}

// كلمات حشو تُزال قبل البصمة (لا تميّز وظيفة عن أخرى)
const STOP = new RegExp(
  '\\b(jobs?|job|vacancy|vacancies|hiring|careers?|full.?time|part.?time|remote|' +
  'senior|junior|sr|jr|lead|the|at|in|of|for|and|a|an|' +
  'وظيفة|وظائف|شاغرة|شاغر|مطلوب|توظيف|عن بعد|دوام كامل|دوام جزئي|' +
  'اول|أول|كبير|مبتدئ|في|من|لدى|و|ال)\\b', 'gi'
);

export function textKey(s) {
  return arabicNormalize(String(s || '').toLowerCase())
    .replace(STOP, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')   // رموز -> مسافة
    .replace(/\s+/g, ' ')
    .trim();
}

// تطبيع الرابط -> host+path بلا بروتوكول/بارامترات/سلاش أخير/بوادئ نطاق شائعة
export function normalizeUrl(u) {
  try {
    const url = new URL(String(u).trim());
    const host = url.hostname
      .replace(/^www\./, '').replace(/^m\./, '')
      .replace(/^sa\./, '').replace(/^ar\./, '').replace(/^arabic\./, '')
      .toLowerCase();
    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    return host + path;
  } catch {
    return String(u || '').trim().toLowerCase().replace(/\/+$/, '');
  }
}

function pick(job, ...keys) {
  for (const k of keys) if (job && job[k]) return job[k];
  return '';
}

// بصمة المحتوى: مسمى + شركة + مدينة (المدينة تمنع دمج وظيفتين مختلفتين بنفس المسمى/الشركة)
export function contentFingerprint(job) {
  const title = textKey(pick(job, 'job_title', 'job_title_ar', 'important_title', 'important_title_ar'));
  const company = textKey(pick(job, 'company', 'important_company'));
  // أول كلمة من الموقع = المدينة (يوحّد "Riyadh" مع "Riyadh, Saudi Arabia" ويميّز مدن مختلفة)
  const loc = textKey(pick(job, 'location', 'location_ar', 'important_location')).split(' ')[0] || '';
  if (!title) return ''; // بلا مسمى لا نبصم بالمحتوى (نعتمد على الرابط)
  return `${title}|${company}|${loc}`;
}

// كل مفاتيح هوية الوظيفة (رابط + بصمة). تكرار = تطابق أي مفتاح.
export function identityKeys(job) {
  const keys = [];
  const url = pick(job, 'job_url', 'important_url', 'source_url', 'url');
  if (url) keys.push('u:' + normalizeUrl(url));
  const fp = contentFingerprint(job);
  if (fp) keys.push('c:' + fp);
  return keys;
}
