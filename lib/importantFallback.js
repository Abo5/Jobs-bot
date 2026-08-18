// بديل محلي لاختيار "أهم الوظائف" بدون ذكاء اصطناعي.
// يُستخدم حين يفشل استدعاء التجميع (AGG) — مثلاً حظر NVIDIA بـ429 —
// حتى لا يتوقف النشر بالكامل بسبب استدعاء AI واحد.
// يحوّل الوظائف المحلَّلة إلى نفس سكيمة important_jobs التي يتوقعها telegram.js.

// الترتيب داخل النطاقات الأربعة (QA · DevOps · Cloud · الأمن السيبراني):
// الترجيح على قوة الدور لا على المجال، والحكومي ما عاد له وزن خاص بعد إلغاء استثنائه.
const AUTOMATION_RE = /automation|\bsdet\b|selenium|cypress|playwright|appium|terraform|ansible|kubernetes|أتمتة|اتمتة/i;
const SOFTWARE_QA_RE = /جودة البرمجيات|software|\bqa\b|\bsdet\b|tester|test engineer|برمجيات|تطبيقات/i;
// أدوار مطلوبة بقوة في السوق السعودي — ترجيح خفيف يرفعها عند التعادل
const HIGH_DEMAND_RE = /red team|penetration|pen.?test|offensive|\bdfir\b|incident response|threat|malware|appsec|application security|\bsoc\b|devops|\bsre\b|site reliability|kubernetes|cloud (engineer|architect|security)|\baws\b|\bazure\b|اختراق|سيبراني|الفريق الأحمر/i;

function score(j) {
  let s = 0;
  if (j.is_software_qa === true) s += 3;              // أكّدها الـAI كداخل النطاق
  if (j.salary && j.salary !== 'غير محدد') s += 2;    // راتب معلن
  if (AUTOMATION_RE.test(`${j.job_title || ''} ${j.job_title_ar || ''} ${j.description || ''}`)) s += 2;
  if (HIGH_DEMAND_RE.test(`${j.job_title || ''} ${j.job_title_ar || ''}`)) s += 2;
  if (SOFTWARE_QA_RE.test(`${j.sector || ''} ${j.job_title || ''} ${j.job_title_ar || ''}`)) s += 1;
  if (/تنفيذي|executive|مدير|manager|رئيس|senior|lead\b|أول/i.test(`${j.experience_level || ''} ${j.job_title || ''} ${j.job_title_ar || ''}`)) s += 1;
  const t = Number(new Date(j.posted_date).getTime());
  if (Number.isFinite(t)) s += t / 1e13; // كسر صغير يرجّح الأحدث عند التعادل
  return s;
}

function whyImportant(j) {
  const t = `${j.job_title || ''} ${j.job_title_ar || ''}`;
  if (/red team|penetration|pen.?test|offensive|ethical hack|اختراق|الفريق الأحمر/i.test(t)) return 'أمن هجومي (Red Team / Pentest)';
  if (/security|\bsoc\b|threat|malware|\bdfir\b|incident|vulnerab|سيبراني|أمن المعلومات/i.test(t)) return 'أمن سيبراني';
  if (/devops|\bsre\b|site reliability|platform|kubernetes|ديف ?اوبس/i.test(t)) return 'DevOps / SRE';
  if (/cloud|\baws\b|\bazure\b|\bgcp\b|سحاب/i.test(t)) return 'حوسبة سحابية';
  if (AUTOMATION_RE.test(t)) return 'اختبار آلي (Automation)';
  if (j.salary && j.salary !== 'غير محدد') return 'راتب معلن';
  return 'وظيفة داخل النطاقات المستهدفة بالسعودية';
}

// المسار البديل كان ينسخ الوصف الخام كما هو. قبل إثراء وصف لنكدإن كان الوصف
// فاضياً فالرسالة تطلع قصيرة؛ وبعد الإثراء صار حتى ٤٠٠٠ حرف فانفجرت رسائل
// تيليجرام. المطلوب سطران لا مقال — نقصّ عند نهاية جملة حتى ما ينقطع الكلام.
const SUMMARY_MAX = Number(process.env.TG_SUMMARY_MAX || 200);

function shortSummary(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= SUMMARY_MAX) return s;
  const cut = s.slice(0, SUMMARY_MAX);
  // نرجع لآخر فاصل جملة داخل النص المقصوص، وإلا لآخر مسافة
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('۔'), cut.lastIndexOf('؟'), cut.lastIndexOf('!'));
  const end = stop > SUMMARY_MAX * 0.5 ? stop + 1 : Math.max(cut.lastIndexOf(' '), 0) || SUMMARY_MAX;
  return cut.slice(0, end).trim() + '…';
}

export function buildFallbackImportant(jobs, limit = 10) {
  return [...jobs]
    .sort((a, b) => score(b) - score(a))
    .slice(0, limit)
    .map((j, i) => ({
      source_job_id: j.job_id,
      important_job_id: i + 1,
      important_title: j.job_title || j.job_title_ar || '',
      important_title_ar: j.job_title_ar || '',
      important_company: j.company || '',
      important_location: j.location_ar || j.location || '',
      important_job_type: j.job_type || 'غير محدد',
      important_salary: j.salary || 'غير محدد',
      important_description_ar: shortSummary(j.description_ar || j.description),
      why_important: j.is_program
        ? `🎓 برنامج توظيف/تدريب — ${j.entity || j.company || ''}`.trim()
        : whyImportant(j),
      important_url: j.apply_url || j.job_url, // رابط التقديم المباشر أولاً، وإلا رابط الإعلان
      source_url: j.job_url
    }))
    .filter(x => x.important_url); // بدون رابط لا نرسل
}
