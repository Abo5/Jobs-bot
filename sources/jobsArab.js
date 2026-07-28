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

// تخصصات الموقع اللي تهمّنا (تقنية + إعلام) — بقية التخصصات عمالية/طبية.
const PROFESSIONS = ['تكنولوجيا-وحاسب', 'اعلام-وصحافة'];

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
