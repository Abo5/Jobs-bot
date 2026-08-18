// مصدر LinkedIn عبر واجهة "الضيف" الرسمية (بدون تسجيل دخول، بدون متصفح، بدون AI).
//   GET https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search
//       ?keywords=<kw>&location=Saudi Arabia&start=<0,10,20,...>
// الرد HTML فيه كروت وظائف كل كرت فيه: الرابط + العنوان + الشركة + الموقع + التاريخ.
// نستخرجها مباشرة (مثل مسار naukrigulf-api) فتتخطّى استخراج NVIDIA.
//
// سبب الحاجة: روابط لنكدإن كانت تجينا فقط من نتائج جوجل، وجوجل صار يحظر
// السكربت بالكابتشا (شوف ملفات blocked-*.png) فاختفت لنكدإن من 16/07. هذا
// المصدر مستقل عن جوجل ولا يُحظر.
import axios from 'axios';
import { hasTargetSignal, isFieldOrCivilJob, isPhysicalSecurity } from '../lib/sectors.js';
import { shouldSkipLinkedin, reportLinkedin429, isTripped } from '../lib/liGate.js';

const BASE = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const DETAIL_BASE = 'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
  'Accept': 'text/html,application/xhtml+xml',
  'X-Requested-With': 'XMLHttpRequest'
};

const LOCATION = process.env.LI_LOCATION || 'Saudi Arabia';
// مواقع إضافية: لنكدإن يرتّب بالصلة ويقصّ النتائج، فالبحث بـ"Saudi Arabia" وحده
// يخفي إعلانات تظهر لما تبحث بالمدينة. المدن تدور بالساعة (مثل الكلمات) حتى ما
// نضاعف الطلبات: كل تشغيلة = المملكة + مدينة واحدة.
const CITIES = (process.env.LI_CITIES || 'Riyadh,Jeddah,Dammam,Khobar,Mecca')
  .split(',').map(s => s.trim()).filter(Boolean);
const PER_PAGE = 10;                                              // ثابت من الواجهة
const MAX_PAGES = Number(process.env.LI_MAX_PAGES || 4);          // 4×10 = ~40/كلمة
const PER_KEYWORD = Number(process.env.LI_PER_KEYWORD || 20);     // سقف لكل كلمة (تمريرة عامة)
// تمريرة الطازج: هي اللي تعبّي القناة فعلاً لأن نافذة القبول يومان.
// صفّرها بـLI_FRESH_PER_KEYWORD=0 لو تبي تعطّلها.
const FRESH_TPR = process.env.LI_FRESH_TPR || 'r86400';           // آخر ٢٤ ساعة
const FRESH_PER_KEYWORD = Number(process.env.LI_FRESH_PER_KEYWORD ?? 30);
// إثراء الوصف من نقطة تفاصيل الوظيفة (jobPosting/{id}).
// ليش يهم: كرت البحث ما فيه وصف إطلاقاً، وقاعدة الفلترة ترفض المسمّى العام
// ("QA Engineer") إلا لو لقت سياقاً برمجياً — وبدون وصف ما تلقاه، فكنا نخسر
// وظائف برمجية حقيقية. الوصف كمان يكشف الميداني المتخفّي خلف مسمّى عام.
const DETAILS = String(process.env.LI_DETAILS ?? 'true').toLowerCase() === 'true';
const DETAILS_MAX = Number(process.env.LI_DETAILS_MAX || 60);     // سقف طلبات التفاصيل/تشغيلة

function unescapeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function firstMatch(block, re) {
  const m = block.match(re);
  return m ? unescapeHtml(m[1]) : '';
}

function isRemote(loc) { return /remote|عن\s*بعد|work from home/i.test(loc || ''); }

// نقسّم الـ HTML عند كل رابط وظيفة، وكل نافذة = كرت واحد
function parseCards(html) {
  const linkRe = /href="(https:\/\/[a-z.]*linkedin\.com\/jobs\/view\/[^"?#]+)/g;
  const hits = [];
  let m;
  while ((m = linkRe.exec(html))) hits.push({ url: m[1], idx: m.index });

  const jobs = [];
  const seen = new Set();
  for (let i = 0; i < hits.length; i++) {
    const url = unescapeHtml(hits[i].url);
    if (seen.has(url)) continue;
    seen.add(url);
    const block = html.slice(hits[i].idx, hits[i + 1]?.idx ?? html.length);

    const location = firstMatch(block, /job-search-card__location[^>]*>\s*([^<]+)/);
    // job_id من ذيل الرابط حصراً. لا تستخدم data-entity-urn من الكتلة: الـurn
    // يسبق الرابط في الـHTML، فكتلة تبدأ عند الرابط تلتقط urn الكرت *التالي* —
    // وهذا كان يعلّق وصف وظيفة على وظيفة ثانية. رقم الرابط مطابق للـurn الصحيح.
    const jobId = url.match(/(\d{8,})(?:\/)?$/)?.[1] ?? '';
    jobs.push({
      source: 'linkedin',
      job_id: jobId,
      job_url: url,
      job_title: firstMatch(block, /base-search-card__title[^>]*>\s*([^<]+)/),
      company: firstMatch(block, /base-search-card__subtitle[^>]*>\s*(?:<a[^>]*>\s*)?([^<]+)/),
      location: location || LOCATION,
      description: '',
      salary: 'غير محدد',
      posted_date: firstMatch(block, /datetime="([^"]+)"/) || 'unknown',
      is_remote: isRemote(location)
    });
  }
  return jobs;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// تراجع عند 429: بعد توسعة الكلمات إلى ٣٦ صار عدد الطلبات ~١٤٤ للبحث وحده،
// ولنكدإن يكتم بعد فترة. انتظارة واحدة طويلة تفكّ الكتم عادةً، فنعيد المحاولة
// مرّة بدل ما نخسر الكلمة كاملة (كنّا نخسر ٨ تمريرات في التشغيلة).
const BACKOFF_MS = Number(process.env.LI_BACKOFF_MS || 25000);

async function fetchPage(keyword, start, tpr = '', retry = true, location = LOCATION) {
  const params = { keywords: keyword, location, start };
  if (tpr) params.f_TPR = tpr;                 // r86400 = آخر ٢٤ ساعة، r604800 = آخر أسبوع
  const { data, status } = await axios.get(BASE, {
    params,
    timeout: 25000,
    headers: HEADERS,
    validateStatus: s => (s >= 200 && s < 400) || s === 429
  });
  if (status === 429) {
    if (!retry) {
      // 429 صعبة (بعد إعادة المحاولة) — تُسجَّل في قاطع الدوائر حتى لو تجاوزت
      // العتبة نوقف كل عمل لنكدإن في التشغيلة بدل المطرقة عليه.
      reportLinkedin429();
      const e = new Error('429'); e.response = { status: 429 }; throw e;
    }
    await sleep(BACKOFF_MS);
    return fetchPage(keyword, start, tpr, false, location);
  }
  return typeof data === 'string' ? parseCards(data) : [];
}

const stripTags = h => unescapeHtml(String(h).replace(/<[^>]+>/g, ' '));

// GET /jobs-guest/jobs/api/jobPosting/{id} -> HTML فيه الوصف الكامل + معايير الوظيفة
async function fetchJobDetails(jobId) {
  const { data, status } = await axios.get(`${DETAIL_BASE}/${jobId}`, {
    timeout: 20000, headers: HEADERS, validateStatus: s => s === 200 || s === 429
  });
  if (status === 429) { const e = new Error('429'); e.rateLimited = true; throw e; }
  const html = String(data);

  const descBlock = html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/)
                 || html.match(/description__text[^>]*>([\s\S]*?)<\/div>/);
  // معايير الوظيفة: المستوى · نوع التوظيف · الوظيفة (Job function) · القطاع.
  // "Job function = Engineering and IT" إشارة قوية تفصل QA البرمجي عن QC الميداني.
  const criteria = {};
  for (const m of html.matchAll(
    /description__job-criteria-subheader[^>]*>\s*([^<]+)[\s\S]*?description__job-criteria-text[^>]*>\s*([^<]+)/g
  )) criteria[stripTags(m[1])] = stripTags(m[2]);

  return { description: descBlock ? stripTags(descBlock[1]).slice(0, 4000) : '', criteria };
}

// نُثري فقط الكروت اللي فيها إشارة QA بالمسمّى ومسمّاها مو ميداني صراحةً —
// هذي هي الوحيدة اللي الوصف يغيّر مصيرها، فنوفّر مئات الطلبات على لنكدإن.
async function enrichWithDetails(jobs) {
  const targets = jobs.filter(j => j.job_id && hasTargetSignal(j.job_title) && !isFieldOrCivilJob(j.job_title) && !isPhysicalSecurity(j.job_title))
                      .slice(0, DETAILS_MAX);
  if (!targets.length) return;

  let ok = 0, failed = 0, backoffs = 0;
  const MAX_BACKOFFS = 2;   // بعدها نسلّم ونكمل التشغيلة بالباقي
  for (const j of targets) {
    try {
      const { description, criteria } = await fetchJobDetails(j.job_id);
      if (description) { j.description = description; ok++; }
      if (criteria['Job function']) j.job_function = criteria['Job function'];
      if (criteria['Seniority level']) j.experience_level = criteria['Seniority level'];
      if (criteria['Employment type']) j.job_type = criteria['Employment type'];
      // لا نحقن Industries/Job function في الوصف: هذي وسوم على مستوى *الشركة*
      // لا الدور، ومضلّلة — KBR (هندسة مصانع) موسومة "IT Services and IT
      // Consulting" فكانت تمرّر وظيفة QA/QC مصانع كأنها برمجية. نخزّنها كحقول
      // منفصلة للعرض فقط، وقرار الفلترة يبقى على نص الوصف الحقيقي.
    } catch (e) {
      failed++;
      // 429 = كتم مؤقّت لا حظر دائم. ننتظر ونكمل بدل ما نتخلّى عن باقي القائمة
      // (كنّا نتوقف عند أول واحد فنخسر نصف الإثراء). القاطع يجمّد لنكدإن كله
      // إذا تعدّت الـ429 الصعبة العتبة — فلا نخسر وقت التشغيلة في مطرقة.
      if (e.rateLimited) {
        reportLinkedin429();
        if (isTripped()) {
          console.warn(`   🚦 [linkedin] أوقفنا الإثراء بعد ${backoffs + 1} استجابة 429 (القاطع فُعّل)`);
          break;
        }
        if (++backoffs > MAX_BACKOFFS) {
          console.warn(`   ⚠️ [linkedin] 429 متكرر عند التفاصيل — أوقفنا الإثراء (أُثري ${ok})`);
          break;
        }
        console.warn(`   ⏳ [linkedin] 429 عند التفاصيل — ننتظر ${BACKOFF_MS / 1000}ث ونكمل (${backoffs}/${MAX_BACKOFFS})`);
        await sleep(BACKOFF_MS);
        continue;
      }
    }
    await sleep(600 + Math.floor(Math.random() * 600));
  }
  console.log(`   ✓ [linkedin] إثراء الوصف: ${ok}/${targets.length} نجحت${failed ? ` (فشل ${failed})` : ''}`);
}

// تجمع وظائف لنكدإن لكل كلمة مفتاحية — نفس شكل مصادر apiSources (تمرّر مباشرة لـ apiJobs)
export async function fetchLinkedinJobs(keywords) {
  // تهدئة عبر التشغيلات: لو تشغيلة سابقة قطعت لنكدإن (429 متتالية)، نتخطّاه
  // كلياً هذه التشغيلة بدل مطرقته وهو مكتوم — وبقية المصادر تكمل كاملة.
  if (shouldSkipLinkedin()) return [];

  const out = [];
  const seen = new Set();

  // تمريرتان لكل كلمة:
  //  1) f_TPR=r86400 — آخر ٢٤ ساعة. لينكدإن يرتّب بالصلة لا بالتاريخ، فالإعلانات
  //     الطازجة تُدفن تحت القديمة ولا تظهر في التمريرة العامة إطلاقاً. قِسناها:
  //     التداخل بين التمريرتين وظيفة واحدة من ١٠، والتمريرة المفلترة كلها داخل
  //     نافذة اليومين بينما العامة واحدة فقط. هذي التمريرة هي اللي تغذّي القناة.
  //  2) بلا فلتر — تغطية أوسع (تفيد لو وُسّعت DATE_WINDOW_DAYS لاحقاً).
  // المدينة تدور بالساعة: كل تشغيلة تبحث المملكة كلها + مدينة واحدة. البحث
  // بالمدينة يُظهر إعلانات يدفنها ترتيب "Saudi Arabia" العام، وتدوير المدن يعطينا
  // التغطية بلا مضاعفة الطلبات.
  const riyadhHour = Number(new Date(Date.now() + 3 * 3600e3).toISOString().slice(11, 13));
  const city = CITIES.length ? CITIES[Math.floor(riyadhHour / 2) % CITIES.length] : null;

  const PASSES = [
    { tpr: FRESH_TPR, label: 'طازج', cap: FRESH_PER_KEYWORD, loc: LOCATION },
    { tpr: '', label: 'عام', cap: PER_KEYWORD, loc: LOCATION }
  ];
  if (city) PASSES.push({ tpr: FRESH_TPR, label: city, cap: FRESH_PER_KEYWORD, loc: city });

  for (const kw of keywords) {
    const perKw = {};
    for (const pass of PASSES) {
      if (!pass.cap) continue;
      let added = 0;
      for (let p = 0; p < MAX_PAGES && added < pass.cap; p++) {
        let rows;
        try {
          rows = await fetchPage(kw, p * PER_PAGE, pass.tpr, true, pass.loc);
        } catch (e) {
          const code = e.response?.status || e.code || e.message;
          console.warn(`   ⚠️ [linkedin] "${kw}" (${pass.label}) page ${p + 1} skipped (${code})`);
          break;
        }
        if (!rows.length) break;
        for (const j of rows) {
          if (!j.job_url || seen.has(j.job_url) || !j.job_title) continue;
          seen.add(j.job_url);
          out.push(j);
          if (++added >= pass.cap) break;
        }
        await sleep(1100 + Math.floor(Math.random() * 700));   // تهدئة (وُسّعت مع ٣٦ كلمة)
      }
      perKw[pass.label] = added;
      if (isTripped()) break;   // القاطع فُعّل — لا نكمل بقية التمريرات ولا الكلمات
    }
    if (isTripped()) break;
    const total = Object.values(perKw).reduce((a, b) => a + b, 0);
    if (total) {
      const detail = Object.entries(perKw).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' + ');
      console.log(`   ✓ [linkedin] "${kw}" -> ${total} (${detail})`);
    }
  }

  console.log(`   ✓ [linkedin] جمعنا ${out.length} وظيفة سعودية من واجهة الضيف${city ? ` (المملكة + ${city})` : ''}`);
  if (DETAILS && !isTripped()) await enrichWithDetails(out);
  return out;
}
