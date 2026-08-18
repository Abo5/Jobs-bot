// مصدر jobs-arab.com (وظائف العرب — القسم السعودي) عبر خلاصات RSS.
// اكتُشف من تحليل التقاط Burp في /root/jobs-apis-and-urls.xml.
//
// ليش RSS: الموقع ووردبريس، والوظائف مخزّنة في نوع محتوى مخصّص ما ينكشف عبر
// wp-json/wp/v2 (الـREST يرجّع مقالة "أهلاً بالعالم" فقط). بالمقابل خلاصات RSS
// تشتغل وترجّع الوظائف كاملة مع العنوان والرابط وتاريخ النشر ونص الإعلان:
//   /sa/feed/                          -> آخر ~70 وظيفة (كل التخصصات)
//   /sa/?s=<كلمة>&feed=rss2            -> بحث بالكلمة المفتاحية
//   /sa/job-profession/<تخصص>/feed/    -> خلاصة تخصص محدد
//
// مهم: بحث ووردبريس لما ما يلاقي نتائج يرجّع الخلاصة العامة كاملة بدل مصفوفة
// فاضية (شفناها مع "IT" -> 70 نتيجة كلها غير ذات صلة). لذلك نتحقق محلياً إن
// نتيجة البحث فيها فعلاً الكلمة، وإلا نعتبرها بلا نتائج.
//
// الرد يُمرَّر مباشرة لمسار apiJobs (نفس شكل مصادر apiSources) — بدون استخراج AI.
import axios from 'axios';

const BASE = 'https://www.jobs-arab.com/sa';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'ar,en;q=0.8',
  Accept: 'application/rss+xml, application/xml, text/xml'
};

// تخصص واحد فقط بعد تضييق النطاق لـQA البرمجيات (2026-08-08): خلاصة 'اعلام-وصحافة'
// انحذفت لأن الإعلام خرج من النطاق، وخلاصات الجودة بالموقع كلها إنشاءات/مصانع.
const PROFESSIONS = ['تكنولوجيا-وحاسب'];

const MAX_PER_FEED = Number(process.env.JOBS_ARAB_PER_FEED || 25);
// الموقع عنده حد معدل صارم: 16 طلب متتالي بفاصل 400ms رجّعوا 429. نهدّي أكثر،
// ونوقف مبكراً عند أول 429 بدل ما نكمل طلبات كلها بتفشل.
const DELAY_MS = Number(process.env.JOBS_ARAB_DELAY_MS || 6000);
const MAX_KEYWORDS = Number(process.env.JOBS_ARAB_MAX_KEYWORDS || 5);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function stripHtml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[|\]\]>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#8211;|&ndash;/g, '-')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? stripHtml(m[1]) : '';
}

function toIso(pubDate) {
  const t = Date.parse(pubDate);
  return Number.isNaN(t) ? 'unknown' : new Date(t).toISOString();
}

// نحاول نطلع المدينة من نص الإعلان (الموقع ما يوفّر حقل موقع منفصل)
const CITY_PATTERN =
  /(الرياض|جدة|جده|مكة|مكه|المدينة المنورة|الدمام|الخبر|الظهران|الأحساء|الاحساء|الطائف|تبوك|بريدة|أبها|ابها|خميس مشيط|حائل|نجران|جازان|ينبع|الجبيل|القصيم|عرعر|سكاكا|الباحة)/;

function parseFeed(xml, sourceLabel) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.map(block => {
    const title = tag(block, 'title');
    const body = tag(block, 'content:encoded') || tag(block, 'description');
    const city = (title + ' ' + body).match(CITY_PATTERN);
    return {
      source: sourceLabel,
      job_url: tag(block, 'link'),
      job_title: title.replace(/^مطلوب\s+/, '').trim(),
      company: '',
      location: city ? `${city[1]} - السعودية` : 'السعودية',
      description: body.slice(0, 400),
      salary: 'غير محدد',
      posted_date: toIso(tag(block, 'pubDate')),
      is_remote: /عن\s*بعد|remote|من المنزل/i.test(title + ' ' + body)
    };
  }).filter(j => j.job_url && j.job_title);
}

async function fetchFeed(url) {
  const { data } = await axios.get(url, {
    timeout: 20000,
    headers: HEADERS,
    responseType: 'text',
    validateStatus: s => s >= 200 && s < 400
  });
  return typeof data === 'string' ? data : '';
}

// هل نتيجة البحث فعلاً ذات صلة؟ (تفادي خلاصة ووردبريس العامة عند صفر نتائج)
function matchesKeyword(job, keyword) {
  const words = String(keyword).toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${job.job_title} ${job.description}`.toLowerCase();
  return words.every(w => hay.includes(w));
}

/* ===================== إثراء من صفحة الوظيفة ===================== */
// خلاصة RSS ناقصة: ما فيها اسم المعلن ولا نوع الدوام ولا الراتب، والمدينة
// نخمّنها بـregex من النص. لكن صفحة الوظيفة نفسها فيها JSON-LD كامل
// (schema.org JobPosting) فيه كل هذي الحقول منظّمة ودقيقة.
//
// نقرأ JSON-LD لا نكشط HTML — أمتن، ولأن الموقع يغيّر تصميمه دون تغيير الـschema.
//
// ملاحظة: بيانات الاتصال (إيميل/جوال) محمية بكابتشا صورة + honeypot ولا تُعرض
// إلا بعد تحقق بشري — ما نلمسها. الرابط يبقى في الرسالة للتقديم.
const DETAIL_DELAY_MS = Number(process.env.JOBS_ARAB_DETAIL_DELAY_MS || 2000);
const DETAIL_MAX = Number(process.env.JOBS_ARAB_DETAIL_MAX || 30);

const EMPLOYMENT_AR = {
  FULL_TIME: 'دوام كامل', PART_TIME: 'دوام جزئي', CONTRACTOR: 'عقد',
  TEMPORARY: 'مؤقت', INTERN: 'تدريب', VOLUNTEER: 'تطوع', OTHER: 'أخرى'
};

function extractJobPosting(html) {
  const blocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const b of blocks) {
    const raw = b.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '').trim();
    let data;
    try { data = JSON.parse(raw); } catch { continue; }
    // الموقع يلفّ كل شي في @graph؛ ندعم الشكلين والمصفوفة
    const nodes = data['@graph'] || (Array.isArray(data) ? data : [data]);
    const jp = nodes.find(n => n && n['@type'] === 'JobPosting');
    if (jp) return jp;
  }
  return null;
}

// بديل لما JSON-LD ما يكون موجود: الوظائف الأقدم/المنتهية يحذف الموقع عنها عقدة
// JobPosting (مطلوب من جوجل عند انتهاء الإعلان) لكن جدول dt/dd يبقى في HTML.
const LABEL_MAP = {
  'المعلن / الشركة': 'company',
  'نوع الوظيفة': 'job_type',
  'المرتب': 'salary',
  'القسم': 'section',
  'مكان العمل': 'city'
};

function extractFromHtmlTable(html) {
  const rows = [...html.matchAll(/<dt class="job-details-label">([\s\S]*?)<\/dt>\s*<dd class="job-details-value">([\s\S]*?)<\/dd>/g)];
  if (!rows.length) return null;
  const out = {};
  for (const [, rawK, rawV] of rows) {
    const key = LABEL_MAP[stripHtml(rawK)];
    if (key) out[key] = stripHtml(rawV);
  }
  return Object.keys(out).length ? out : null;
}

function mergeHtmlDetail(job, t) {
  return {
    ...job,
    company: t.company || job.company,
    location: t.city ? `${t.city} - السعودية` : job.location,
    job_type: t.job_type || '',
    salary: t.salary || job.salary,
    section: t.section || ''
  };
}

function mergeDetail(job, jp) {
  const org = jp.hiringOrganization?.name || '';
  const loc = jp.jobLocation?.address || {};
  const city = jp.jobLocation?.name || loc.addressLocality || '';
  const region = loc.addressRegion || '';
  const types = [].concat(jp.employmentType || []).map(t => EMPLOYMENT_AR[t] || t).filter(Boolean);

  // الوصف عند هذا الموقع يحتوي غالباً سطر "الشروط:" أصلاً، وqualifications تعيده
  // بصياغة مختصرة. نضيفها فقط لو فيها معلومة جديدة فعلاً (تفادي تكرار داخل الرسالة).
  const desc = stripHtml(jp.description);
  const quals = stripHtml(jp.qualifications);
  const norm = s => s.replace(/[\s\-–—:،.]/g, '');
  const qualsAdd = quals && !norm(desc).includes(norm(quals).slice(0, 40));
  const parts = [desc, qualsAdd ? `الشروط: ${quals}` : ''].filter(Boolean);

  return {
    ...job,
    company: org || job.company,
    location: city ? [city, region, 'السعودية'].filter(Boolean).join(' - ') : job.location,
    job_type: types.join(' / ') || '',
    salary: stripHtml(jp.jobBenefits) || job.salary,
    section: jp.occupationalCategory || '',
    description: (parts.join(' — ') || job.description).slice(0, 700),
    posted_date: jp.datePosted ? new Date(jp.datePosted).toISOString() : job.posted_date,
    valid_through: jp.validThrough || ''
  };
}

/**
 * يثري وظائف jobs-arab بحقول صفحة الوظيفة (JSON-LD).
 * يُنادى بعد الفلترة عشان نجيب صفحات الوظائف الباقية فقط لا كل شي.
 * @param {Array} jobs وظائف من fetchJobsArab
 * @returns {Promise<Array>} نفس المصفوفة بحقول مُثراة (اللي يفشل يبقى كما هو)
 */
export async function enrichJobsArab(jobs = []) {
  const targets = jobs.filter(j => /jobs-arab\.com/.test(j.job_url || '')).slice(0, DETAIL_MAX);
  if (!targets.length) return jobs;

  const byUrl = new Map();
  let ok = 0;

  console.log(`   🔎 [jobs-arab] إثراء ${targets.length} وظيفة من صفحاتها...`);
  for (const j of targets) {
    try {
      const { data } = await axios.get(j.job_url, {
        timeout: 20000, headers: { ...HEADERS, Accept: 'text/html' }, responseType: 'text'
      });
      const html = String(data);
      const jp = extractJobPosting(html);
      if (jp) {
        byUrl.set(j.job_url, mergeDetail(j, jp)); ok++;
      } else {
        const t = extractFromHtmlTable(html);
        if (t) { byUrl.set(j.job_url, mergeHtmlDetail(j, t)); ok++; }
      }
    } catch (e) {
      if (e.response?.status === 429) {
        console.warn('   ⚠️ [jobs-arab] 429 عند الإثراء — نوقف ونكمل بالمتوفر');
        break;
      }
    }
    await sleep(DETAIL_DELAY_MS);
  }

  console.log(`   ✓ [jobs-arab] أُثريت ${ok}/${targets.length} وظيفة (شركة + مدينة + نوع دوام + راتب)`);
  return jobs.map(j => byUrl.get(j.job_url) || j);
}

/**
 * يجمع وظائف سعودية من jobs-arab.com.
 * @param {string[]} keywords كلمات البحث (تُستخدم مع خلاصة البحث)
 * @returns {Promise<Array>} وظائف بنفس شكل مصادر apiSources
 */
export async function fetchJobsArab(keywords = []) {
  const out = [];
  const seen = new Set();

  const push = jobs => {
    let added = 0;
    for (const j of jobs.slice(0, MAX_PER_FEED)) {
      if (seen.has(j.job_url)) continue;
      seen.add(j.job_url);
      out.push(j);
      added++;
    }
    return added;
  };

  // 1) الخلاصة العامة — آخر الوظائف المنشورة (الأطزج، تُفلتر بالقطاع لاحقاً)
  try {
    const n = push(parseFeed(await fetchFeed(`${BASE}/feed/`), 'jobs-arab'));
    console.log(`   ✓ [jobs-arab] الخلاصة العامة -> ${n}`);
  } catch (e) {
    console.warn(`   ⚠️ [jobs-arab] الخلاصة العامة فشلت: ${e.message}`);
  }

  // 2) خلاصات التخصصات التقنية/الإعلامية
  for (const prof of PROFESSIONS) {
    await sleep(DELAY_MS);
    try {
      const url = `${BASE}/job-profession/${encodeURIComponent(prof)}/feed/`;
      const n = push(parseFeed(await fetchFeed(url), 'jobs-arab'));
      if (n) console.log(`   ✓ [jobs-arab] تخصص "${prof}" -> ${n}`);
    } catch (e) {
      console.warn(`   ⚠️ [jobs-arab] تخصص "${prof}" فشل: ${e.message}`);
    }
  }

  // 3) بحث بالكلمات المفتاحية (مع حماية من خلاصة "صفر نتائج" العامة).
  //    نحدّ عدد الكلمات ونتوقف عند 429 — الخلاصتان فوق تغطيان الأساس أصلاً.
  for (const kw of keywords.slice(0, MAX_KEYWORDS)) {
    await sleep(DELAY_MS);
    try {
      const url = `${BASE}/?s=${encodeURIComponent(kw)}&feed=rss2`;
      const parsed = parseFeed(await fetchFeed(url), 'jobs-arab');
      const relevant = parsed.filter(j => matchesKeyword(j, kw));
      const n = push(relevant);
      if (n) console.log(`   ✓ [jobs-arab] "${kw}" -> ${n}`);
    } catch (e) {
      if (e.response?.status === 429) {
        console.warn('   ⚠️ [jobs-arab] وصلنا حد المعدل (429) — نوقف البحث بالكلمات');
        break;
      }
      console.warn(`   ⚠️ [jobs-arab] "${kw}" فشل: ${e.message}`);
    }
  }

  console.log(`   ✓ [jobs-arab] جمعنا ${out.length} وظيفة سعودية`);
  return out;
}
