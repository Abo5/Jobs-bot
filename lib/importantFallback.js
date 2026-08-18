// بديل محلي لاختيار "أهم الوظائف" وكتابة رسائلها بدون ذكاء اصطناعي.
// يُستخدم حين يفشل استدعاء التجميع (AGG) — مثلاً حظر NVIDIA بـ429 —
// حتى لا يتوقف النشر بالكامل بسبب استدعاء AI واحد.
// يحوّل الوظائف المحلَّلة إلى نفس سكيمة important_jobs التي يتوقعها telegram.js:
// حقائق (شركة · موقع · راتب · رابط) من البيانات الأصلية، والوصف من قوالب محلية
// حتمية حسب الفئة — بلا أي اختلاق.

import { categoryForJob } from './sectors.js';

// الترتيب داخل الفئات: الترجيح على قوة الدور وحداثته، مع وزن خفيف لفئات
// الإعلانات (قبول/تسجيل · حكومية · برامج) حتى لا تختفي خلف الوظائف التقنية.
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
  if (j.is_admission || j.is_government) s += 2;      // إعلانات رسمية تستحق الظهور
  if (j.is_program) s += 1;
  const t = Number(new Date(j.posted_date).getTime());
  if (Number.isFinite(t)) s += t / 1e13; // كسر صغير يرجّح الأحدث عند التعادل
  return s;
}

/* ---------- قوالب الوصف حسب الفئة (حتمية — بلا اختلاق) ---------- */
// تُستخدم فقط حين يفشل الذكاء الاصطناعي: وصف عام وآمن مشتق من الفئة نفسها،
// ويُحيل التفاصيل للرابط الرسمي بدل تلفيق شروط أو مواعيد.
const DESCRIPTION_TEMPLATES = {
  'ضمان الجودة': 'المسؤوليات تشمل اختبار الأنظمة والتطبيقات: إعداد حالات الاختبار وتنفيذها، رصد العيوب وتوثيقها، والتنسيق مع فريق التطوير لضمان الجودة قبل الإطلاق.',
  'DevOps': 'المسؤوليات تشمل تشغيل خطوط CI/CD وإدارة البنية التحتية، أتمتة النشر، مراقبة الأداء والاستقرار، والتعامل مع الحوادث التقنية.',
  'السحابة': 'المسؤوليات تشمل تصميم البنية السحابية وإدارتها، تحسين الأداء والتكلفة، وضمان أمن الموارد السحابية وأتمتتها.',
  'الأمن السيبراني': 'المسؤوليات تشمل مراقبة التهديدات والاستجابة للحوادث، فحص الثغرات وتقييم المخاطر، وتطبيق ضوابط الأمن السيبراني.',
  'وظيفة حكومية': 'وظيفة حكومية — التفاصيل الكاملة للشروط والمهام في إعلان الجهة عبر الرابط المرفق.',
  'فتح قبول وتسجيل': 'إعلان فتح قبول/تسجيل — التفاصيل الكاملة للشروط والمواعيد والتخصصات في الإعلان الرسمي عبر الرابط المرفق.',
  'برنامج توظيف/تدريب': 'برنامج توظيف/تدريب — التفاصيل الكاملة للشروط والمسار في إعلان الجهة عبر الرابط المرفق.',
  'default': 'التفاصيل الكاملة للمهام والشروط في الإعلان عبر الرابط المرفق.'
};

/** قالب وصف حتمي حسب فئة الوظيفة — يكمّل أي وصف ناقص من الـAI */
export function fallbackDescriptionFor(j) {
  const cat = categoryForJob(j);
  if (!cat) return DESCRIPTION_TEMPLATES.default;
  const label = cat.label;
  if (label.startsWith('فتح قبول وتسجيل')) return DESCRIPTION_TEMPLATES['فتح قبول وتسجيل'];
  if (label.startsWith('برنامج توظيف/تدريب')) return DESCRIPTION_TEMPLATES['برنامج توظيف/تدريب'];
  return DESCRIPTION_TEMPLATES[label] || DESCRIPTION_TEMPLATES.default;
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
    .map((j, i) => {
      const cat = categoryForJob(j) || { emoji: '📌', label: 'فرصة وظيفية' };
      return {
        source_job_id: j.job_id,
        important_job_id: i + 1,
        important_title: j.job_title || j.job_title_ar || '',
        important_company: j.company || '',
        important_location: j.location_ar || j.location || '',
        important_job_type: j.job_type || 'غير محدد',
        important_salary: j.salary || 'غير محدد',
        // وصف حتمي: لو المصدر وفّر وصفاً نستخدمه (مقصوصاً)، وإلا قالب الفئة
        important_description_ar: shortSummary(j.description_ar || j.description) || fallbackDescriptionFor(j),
        category_emoji: cat.emoji,
        category_label_ar: cat.label,
        important_url: j.apply_url || j.job_url, // رابط التقديم المباشر أولاً، وإلا رابط الإعلان
        source_url: j.job_url
      };
    })
    .filter(x => x.important_url); // بدون رابط لا نرسل
}
