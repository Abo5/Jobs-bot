// مصدر NaukriGulf عبر واجهة تطبيق الجوال الرسمية (JSON منظّم، بدون متصفح وبدون AI).
// اكتُشفت الواجهة من التقاط حركة التطبيق (api-jobs.xml):
//   GET https://www.ngma.mobi/spapi/jobapi/search?Location=السعودية&Offset=..&Limit=..
// الرد JSON فيه كل الحقول جاهزة، فتُمرَّر مباشرة لمسار apiJobs (يتخطّى استخراج NVIDIA).
//
// ملاحظات من الفحص الميداني:
// - هيدر "Et" (توكن مضاد للبوت) غير إلزامي؛ بدونه يرجع الرد بمفاتيح Capitalized.
// - الترقيم عبر Offset فقط (خطوات = Limit)؛ pageNo بلا أثر.
//
// تحديث 2026-07-26 (من تحليل التقاط Burp في jobs-apis-and-urls.xml):
// - الاسم الصحيح للبارامتر هو "Keywords" بالجمع — وليس "Keyword" المفرد الذي كان
//   يُتجاهَل. مع Keywords يصير البحث موجّهاً على مستوى الخادم:
//   "QA QC" -> 45 نتيجة، "machine learning" -> 75 بدل سحب 150 وظيفة عامة وفلترتها محلياً.
// - "SortPreference=date" يرتّب بالأحدث (بدونه الترتيب بالصلة والتواريخ مبعثرة).
// - الكلمات العربية ما تنفع كـ Keywords هنا: "أمن سيبراني" رجّعت 7154 (أي كل
//   الوظائف بلا فلترة). لذلك نمرّر الكلمات اللاتينية فقط، والعربية تُغطّى
//   عبر المسح العام + مصادر أخرى (لنكدإن / وظائف العرب).
import axios from 'axios';

const BASE = 'https://www.ngma.mobi/spapi/jobapi/search';

// نفس هيدرات التطبيق الملتقطة (بدون Et/Deviceid المتغيّرة — غير مطلوبة).
const HEADERS = {
  Appid: '22',
  'Client-Type': 'ios',
  Systemid: 'ngjobseekerIos',
  Appversion: '18.3',
  Clientid: '1f0n3',
  Accept: 'application/json',
  'Device-Type': 'MobileApp',
  'Accept-Language': 'ENGLISH',
  'User-Agent': 'NaukriGulf/7 CFNetwork/3860.200.71 Darwin/25.1.0'
};

const LOCATION = process.env.NG_API_LOCATION || 'السعودية';
// البحث بالكلمات يحتاج اسم الدولة بالإنجليزي (الواجهة تطابقه مع نص الكلمة اللاتيني)
const LOCATION_EN = process.env.NG_API_LOCATION_EN || 'Saudi Arabia';
const LIMIT = Number(process.env.NG_API_LIMIT || 25);
const MAX_PAGES = Number(process.env.NG_API_MAX_PAGES || 6); // 6 × 25 = ~150 أحدث وظيفة
const KEYWORD_PAGES = Number(process.env.NG_API_KEYWORD_PAGES || 2); // 2 × 25 = ~50 لكل كلمة
const MAX_AGE_DAYS = Number(process.env.NG_API_MAX_AGE_DAYS || 3); // نكتفي بالطازج

// الكلمات اللاتينية فقط تنفع مع Keywords (شوف الملاحظة أعلى الملف)
function isLatinKeyword(kw) {
  return /^[\x20-\x7E]+$/.test(String(kw || '').trim());
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function isRemote(location) {
  return /عن\s*بعد|remote|work from home/i.test(String(location || ''));
}

// LatestPostedDate = ثواني يونكس نصية
function toIso(unixSec) {
  const n = Number(unixSec);
  if (!n) return 'unknown';
  return new Date(n * 1000).toISOString();
}

function mapJob(raw) {
  const j = raw?.Job || raw || {};
  return {
    source: 'naukrigulf-api',
    job_url: j.JdURL || '',
    job_title: (j.Designation || '').trim(),
    company: (j.Company?.Name || '').trim(),
    location: (j.Location || '').trim(),
    description: stripHtml(j.jobInfo || j.Description).slice(0, 400),
    salary: 'غير محدد',
    posted_date: toIso(j.LatestPostedDate),
    is_remote: isRemote(j.Location),
    _postedUnix: Number(j.LatestPostedDate) || 0,
    _jobId: j.JobId || ''
  };
}

async function fetchPage(offset, keyword = '') {
  const params = keyword
    ? { Location: LOCATION_EN, Keywords: keyword, SortPreference: 'date', Limit: LIMIT, Offset: offset, pageNo: 1 }
    : { Location: LOCATION, Limit: LIMIT, Offset: offset, pageNo: 1 };

  const { data } = await axios.get(BASE, {
    params,
    timeout: 25000,
    headers: HEADERS,
    // الرد gzip؛ axios يفكه تلقائياً
    validateStatus: s => s >= 200 && s < 400
  });
  return Array.isArray(data?.Jobs) ? data.Jobs : [];
}

// يمسح صفحات متتالية (عام أو لكلمة مفتاحية) ويضيف الطازج فقط إلى out.
// كل المسارين مرتّبان بالأحدث، فنوقف أول ما تصير صفحة كاملة أقدم من العتبة.
async function sweep({ keyword = '', pages, cutoff, out, seen, label }) {
  let added = 0;

  for (let page = 0; page < pages; page++) {
    let rows;
    try {
      rows = await fetchPage(page * LIMIT, keyword);
    } catch (e) {
      const code = e.response?.status || e.code || e.message;
      console.warn(`   ⚠️ [naukrigulf-api] ${label} page ${page + 1} skipped (${code})`);
      break;
    }
    if (!rows.length) break;

    let staleOnPage = 0;
    for (const raw of rows) {
      const j = mapJob(raw);
      if (!j.job_url || seen.has(j.job_url)) continue;
      if (cutoff && j._postedUnix && j._postedUnix < cutoff) { staleOnPage++; continue; }
      seen.add(j.job_url);
      delete j._postedUnix;
      delete j._jobId;
      out.push(j);
      added++;
    }

    if (cutoff && staleOnPage === rows.length) break;
  }

  return added;
}

/**
 * ترجع مصفوفة وظائف بنفس شكل مصادر apiSources (يمرّرها main إلى apiJobs مباشرة).
 * @param {string[]} keywords كلمات البحث؛ اللاتينية منها تُبحث بالخادم عبر Keywords.
 */
export async function fetchNaukrigulfApiJobs(keywords = []) {
  const cutoff = MAX_AGE_DAYS > 0
    ? Math.floor(Date.now() / 1000) - MAX_AGE_DAYS * 86400
    : 0;

  const out = [];
  const seen = new Set();

  // 1) مسح عام بأحدث وظائف السعودية — يمسك الحكومي والمسميات غير المتوقّعة
  //    اللي ما تطابق أي كلمة مفتاحية.
  const general = await sweep({ pages: MAX_PAGES, cutoff, out, seen, label: 'general' });
  console.log(`   ✓ [naukrigulf-api] المسح العام -> ${general}`);

  // 2) بحث موجّه لكل كلمة لاتينية (دقّة أعلى بكثير من الفلترة المحلية)
  const latin = keywords.filter(isLatinKeyword);
  for (const kw of latin) {
    const added = await sweep({
      keyword: kw, pages: KEYWORD_PAGES, cutoff, out, seen, label: `"${kw}"`
    });
    if (added) console.log(`   ✓ [naukrigulf-api] "${kw}" -> ${added}`);
    await new Promise(r => setTimeout(r, 300 + Math.floor(Math.random() * 300))); // تهدئة
  }

  const skipped = keywords.length - latin.length;
  console.log(
    `   ✓ [naukrigulf-api] جمعنا ${out.length} وظيفة سعودية طازجة (آخر ${MAX_AGE_DAYS} يوم)` +
    (skipped ? ` | تخطّينا ${skipped} كلمة عربية (الواجهة ما تدعمها)` : '')
  );
  return out;
}
