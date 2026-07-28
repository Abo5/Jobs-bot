// بديل محلي لاختيار "أهم الوظائف" بدون ذكاء اصطناعي.
// يُستخدم حين يفشل استدعاء التجميع (AGG) — مثلاً حظر NVIDIA بـ429 —
// حتى لا يتوقف النشر بالكامل بسبب استدعاء AI واحد.
// يحوّل الوظائف المحلَّلة إلى نفس سكيمة important_jobs التي يتوقعها telegram.js.

const TECH_RE = /تقنية|technolog|\bit\b|software|مبرمج|developer|أمن|سيبراني|cyber|بيانات|data|شبكات|network/i;

function score(j) {
  let s = 0;
  if (j.is_government === true) s += 4;               // حكومي أولوية
  if (j.salary && j.salary !== 'غير محدد') s += 2;    // راتب معلن
  if (TECH_RE.test(`${j.sector || ''} ${j.job_title || ''} ${j.job_title_ar || ''}`)) s += 1;
  if (/تنفيذي|executive|مدير|manager|رئيس|senior|أول/i.test(`${j.experience_level || ''} ${j.job_title || ''} ${j.job_title_ar || ''}`)) s += 1;
  const t = Number(new Date(j.posted_date).getTime());
  if (Number.isFinite(t)) s += t / 1e13; // كسر صغير يرجّح الأحدث عند التعادل
  return s;
}

function whyImportant(j) {
  if (j.is_government === true) return 'جهة حكومية';
  if (j.sector && j.sector !== 'أخرى') return `قطاع ${j.sector}`;
  if (j.salary && j.salary !== 'غير محدد') return 'راتب معلن';
  return 'وظيفة سعودية مطابقة للمعايير';
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
      important_description_ar: j.description_ar || j.description || '',
      why_important: whyImportant(j),
      important_url: j.apply_url || j.job_url, // رابط التقديم المباشر أولاً، وإلا رابط الإعلان
      source_url: j.job_url
    }))
    .filter(x => x.important_url); // بدون رابط لا نرسل
}
