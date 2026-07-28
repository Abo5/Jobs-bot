// Job scraper: Google + Naukrigulf + 6 free job APIs + 7 optional-key APIs
// -> AI extraction (NVIDIA) -> important jobs -> Telegram channel
//
// ملاحظات:
// 1) يحتاج Node.js حديث
// 2) يحتاج ملف keywords.json فيه array من الكلمات
// 3) ضع المفاتيح/القيم الحساسة في .env (راجع .env للمفاتيح الاختيارية)

import 'dotenv/config';
import dns from 'dns';
try { dns.setDefaultResultOrder('ipv4first'); } catch {}

import puppeteer from 'puppeteer';
import fs from 'fs';
import axios from 'axios';
import pLimit from 'p-limit';

import { callAI, safeJsonParse } from './lib/ai.js';
import { sendJobsToTelegram } from './lib/telegram.js';
import { isSaudiLocation } from './lib/saudi.js';
import { passesSectorRule } from './lib/sectors.js';
import { API_SOURCES, GLOBAL_REMOTE_SOURCES } from './sources/apiSources.js';
import { scrapeNaukrigulf } from './sources/naukrigulf.js';
import { fetchWadhefa, fetchEwdifh, fetchSabbar } from './sources/saudiSites.js';
import { fetchNaukrigulfApiJobs } from './sources/naukrigulfApi.js';
import { fetchLinkedinJobs } from './sources/linkedin.js';
import { fetchJobsArab } from './sources/jobsArab.js';
import { fetchYahooLinks } from './sources/yahooSearch.js';
import { buildFallbackImportant } from './lib/importantFallback.js';
import { buildSmartQueries } from './lib/queryBuilder.js';
import { getApplyUrl } from './lib/applyLink.js';
import { SeenStore } from './lib/seenStore.js';
import { filterJobs } from './lib/jobFilter.js';
import { config as dateWindowConfig } from './lib/dateWindow.js';

/* ===================== CONFIG ===================== */
const MAX_AI_LINKS = Number(process.env.MAX_AI_LINKS || 50);
const MAX_AI_PARALLEL = Number(process.env.MAX_AI_PARALLEL || 4);
const MAX_PAGES = Number(process.env.MAX_PAGES || 3);
const GOOGLE_REGION = process.env.GOOGLE_REGION || 'sa';
const GOOGLE_LANG = process.env.GOOGLE_LANG || 'en';

const ENABLE_AI = String(process.env.ENABLE_AI || 'true').toLowerCase() === 'true';
// جوجل صار يحظر السكربت بالكابتشا بالكامل — مطفأ افتراضياً، وياهو بديله (HTTP، لا يُحظر)
const ENABLE_GOOGLE = String(process.env.ENABLE_GOOGLE || 'false').toLowerCase() === 'true';
const ENABLE_YAHOO = String(process.env.ENABLE_YAHOO || 'true').toLowerCase() === 'true';
const ENABLE_NAUKRIGULF = String(process.env.ENABLE_NAUKRIGULF || 'true').toLowerCase() === 'true';
const ENABLE_SAUDI_SITES = String(process.env.ENABLE_SAUDI_SITES || 'true').toLowerCase() === 'true';
const ENABLE_APIS = String(process.env.ENABLE_APIS || 'true').toLowerCase() === 'true';
const ENABLE_NAUKRIGULF_API = String(process.env.ENABLE_NAUKRIGULF_API || 'true').toLowerCase() === 'true';
const ENABLE_LINKEDIN = String(process.env.ENABLE_LINKEDIN || 'true').toLowerCase() === 'true';
const ENABLE_JOBS_ARAB = String(process.env.ENABLE_JOBS_ARAB || 'true').toLowerCase() === 'true';
const ENABLE_GLOBAL_REMOTE_APIS = String(process.env.ENABLE_GLOBAL_REMOTE_APIS || 'false').toLowerCase() === 'true';
const ENABLE_TELEGRAM = String(process.env.ENABLE_TELEGRAM || 'true').toLowerCase() === 'true';
const API_PARALLEL = Number(process.env.API_PARALLEL || 6);

const UA_STR =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const UA = {
  'User-Agent': UA_STR,
  'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
  'Accept': 'text/html,application/xhtml+xml'
};

/* ===================== JOB KEYWORDS ===================== */
const KEYWORDS_FILE = 'keywords.json';

let JOB_KEYWORDS = [];
try {
  const raw = fs.readFileSync(KEYWORDS_FILE, 'utf8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed) || parsed.some(x => typeof x !== 'string')) {
    throw new Error('keywords.json must contain a JSON array of strings');
  }

  JOB_KEYWORDS = parsed.map(s => s.trim()).filter(Boolean);
  console.log(`🔑 Loaded ${JOB_KEYWORDS.length} keywords from ${KEYWORDS_FILE}`);
} catch (err) {
  console.error(`❌ Failed to load ${KEYWORDS_FILE}: ${err.message}`);
  process.exit(1);
}

// استعلامات جوجل "الذكية": نفس المسميات + مدن سعودية فعلية (مثل "node js developer Riyadh")
// بدل "Saudi Arabia" العامة بس. Naukrigulf/wadhefa يستخدمون JOB_KEYWORDS الخام
// (Naukrigulf يشيل أسماء المدن من الاستعلام أصلاً، فالدمج معه بلا فايدة).
const CITIES_PER_ROLE = Number(process.env.SMART_QUERY_CITIES_PER_ROLE || 2);
const GOOGLE_QUERIES = buildSmartQueries(JOB_KEYWORDS, { citiesPerRole: CITIES_PER_ROLE });
console.log(`🧠 Built ${GOOGLE_QUERIES.length} smart Google queries from ${JOB_KEYWORDS.length} roles (${CITIES_PER_ROLE} cities/role)`);

/* ============================== MAIN ============================== */
(async function main() {
  console.log('▶️ Start job scraping\n');

  // مخزن الوظائف المُعالَجة سابقاً (ديدوب عبر التشغيلات) + وقت مرجعي ثابت للتشغيل كامل
  const NOW = Date.now();
  const seen = new SeenStore();
  console.log(`🗂️ Seen-store: ${seen.size} مفتاح محفوظ | نافذة القبول: آخر ${dateWindowConfig.WINDOW_DAYS} يوم (اليوم+أمس)${dateWindowConfig.DROP_UNKNOWN ? ' | إسقاط التواريخ المجهولة' : ''}\n`);

  /* ---------- 1) مصادر الـ API الجاهزة (بدون متصفح) ---------- */
  let apiJobs = [];
  if (ENABLE_APIS) {
    const globalNames = new Set(GLOBAL_REMOTE_SOURCES.map(s => s.name));
    const active = API_SOURCES.filter(s => {
      if (!ENABLE_GLOBAL_REMOTE_APIS && globalNames.has(s.name)) return false; // عالمية، نادراً سعودية
      return !s.needsKey || hasKeyFor(s.name);
    });
    console.log(`🌐 Collecting from ${active.length}/${API_SOURCES.length} job APIs (rest disabled/need keys)...`);
    apiJobs = await collectFromAPIs(JOB_KEYWORDS, active);

    // NaukriGulf عبر واجهة تطبيق الجوال (JSON منظّم، بدون AI) — مصدر سعودي موثوق
    // لا يتأثر بحظر جوجل ولا بحد NVIDIA للطلبات. يُدمج ضمن مسار apiJobs.
    if (ENABLE_NAUKRIGULF_API) {
      try {
        // نمرّر الكلمات المفتاحية: اللاتينية منها تُبحث بالخادم عبر Keywords
        // (دقّة أعلى بكثير من سحب أحدث 150 وظيفة وفلترتها محلياً).
        const ngJobs = await fetchNaukrigulfApiJobs(JOB_KEYWORDS);
        const known = new Set(apiJobs.map(j => (j.job_url || '').split('#')[0]));
        for (const j of ngJobs) {
          const key = (j.job_url || '').split('#')[0];
          if (key && !known.has(key)) { known.add(key); apiJobs.push(j); }
        }
      } catch (e) {
        console.warn(`   ⚠️ [naukrigulf-api] failed: ${e.message}`);
      }
    }

    // وظائف العرب (jobs-arab.com) عبر RSS — مصدر سعودي يشتغل بدون حظر
    // ويغطّي إعلانات عربية ما توصلنا من لنكدإن/نوكري. بيانات منظّمة بلا AI.
    if (ENABLE_JOBS_ARAB) {
      try {
        const jaJobs = await fetchJobsArab(JOB_KEYWORDS);
        const known = new Set(apiJobs.map(j => (j.job_url || '').split('?')[0]));
        for (const j of jaJobs) {
          const key = (j.job_url || '').split('?')[0];
          if (key && !known.has(key)) { known.add(key); apiJobs.push(j); }
        }
      } catch (e) {
        console.warn(`   ⚠️ [jobs-arab] failed: ${e.message}`);
      }
    }

    // LinkedIn عبر واجهة الضيف (بديل مستقل عن جوجل المحظور) — بيانات منظّمة بلا AI
    if (ENABLE_LINKEDIN) {
      try {
        const liJobs = await fetchLinkedinJobs(JOB_KEYWORDS);
        const known = new Set(apiJobs.map(j => (j.job_url || '').split('?')[0]));
        for (const j of liJobs) {
          const key = (j.job_url || '').split('?')[0];
          if (key && !known.has(key)) { known.add(key); apiJobs.push(j); }
        }
      } catch (e) {
        console.warn(`   ⚠️ [linkedin] failed: ${e.message}`);
      }
    }

    const beforeFilter = apiJobs.length;
    apiJobs = apiJobs.filter(j =>
      isSaudiLocation(j.location) &&
      passesSectorRule({ company: j.company, title: j.job_title, description: j.description })
    );
    console.log(`📦 API jobs: ${beforeFilter} -> ${apiJobs.length} بعد فلترة "سعودية + (حكومي أي مجال / خاص: تقنية أو QA-QC أو ذكاء اصطناعي أو أمن سيبراني أو علاقات عامة أو إعلام)" (استبعدنا ${beforeFilter - apiJobs.length})\n`);
  }

  /* ---------- 2) جوجل + Naukrigulf (عبر متصفح) ---------- */
  let browserLinks = [];
  if (ENABLE_GOOGLE || ENABLE_NAUKRIGULF) {
    browserLinks = await runBrowserScrape();
  }

  /* ---------- 2ج) بحث ياهو (بديل جوجل المحظور، HTTP بدون متصفح) ---------- */
  if (ENABLE_YAHOO) {
    console.log('🔎 Searching via Yahoo (Google replacement)...');
    try {
      const yahooLinks = await fetchYahooLinks(GOOGLE_QUERIES);
      browserLinks = [...new Set([...browserLinks, ...yahooLinks])];
    } catch (e) {
      console.warn(`⚠️ [yahoo] failed: ${e.message}`);
    }
  }

  /* ---------- 2ب) مواقع سعودية إضافية (بدون متصفح) ---------- */
  if (ENABLE_SAUDI_SITES) {
    console.log('🇸🇦 Collecting from wadhefa.com + ewdifh.com + sabbar.com...');
    const siteLinks = new Set();

    for (const kw of JOB_KEYWORDS) {
      (await fetchWadhefa(kw)).forEach(l => siteLinks.add(l));
    }
    (await fetchEwdifh(2)).forEach(l => siteLinks.add(l));
    (await fetchSabbar(2)).forEach(l => siteLinks.add(l));

    console.log(`>>> [saudi-sites] found ${siteLinks.size} candidate links\n`);
    // المواقع السعودية المخصّصة أولاً (مضمونة الوصول، لا تُحظر) — قبل روابط جوجل
    // اللي أغلبها لمواقع محظورة (bayt/gulftalent/glassdoor) وتهدر حصة MAX_AI_LINKS
    browserLinks = [...new Set([...siteLinks, ...browserLinks])];
  }

  // ديدوب مبكّر لروابط المتصفح: نشيل الروابط اللي عولجت في تشغيل سابق (نفس الرابط)
  // قبل استدعاء AI — يوفّر حصة MAX_AI_LINKS وطلبات NVIDIA على وظائف مكررة.
  if (browserLinks.length) {
    const before = browserLinks.length;
    browserLinks = browserLinks.filter(url => !seen.has({ job_url: url }));
    if (before !== browserLinks.length) {
      console.log(`🧹 ديدوب مبكّر: استبعدنا ${before - browserLinks.length} رابط سبق معالجته (بقي ${browserLinks.length})`);
    }
  }

  const timestamp = new Date().toISOString().split('T')[0];
  if (browserLinks.length) fs.writeFileSync(`job-links-${timestamp}.txt`, browserLinks.join('\n'), 'utf8');
  if (apiJobs.length) fs.writeFileSync(`api-jobs-${timestamp}.json`, JSON.stringify(apiJobs, null, 2), 'utf8');

  console.log(`\n✅ Totals: ${apiJobs.length} API jobs + ${browserLinks.length} browser links\n`);

  if (!apiJobs.length && !browserLinks.length) {
    console.log('❌ No jobs found from any source. Bye.');
    return;
  }

  if (!ENABLE_AI) {
    console.log('ℹ️ AI extraction disabled. Saved raw data only.');
    return;
  }

  /* ---------- 3) تحليل AI ---------- */
  const analyzedJobs = [];

  // بيانات الـ API منظمة أصلاً -> نحولها للسكيمة مباشرة بدون استدعاء AI (يوفر تكلفة ويكون أدق)
  apiJobs.forEach(j => analyzedJobs.push(apiToSchema(j, analyzedJobs.length + 1)));

  // روابط جوجل/Naukrigulf تحتاج جلب HTML ثم استخراج AI
  if (browserLinks.length) {
    const limitAI = pLimit(MAX_AI_PARALLEL);
    const FRAGILE_HOSTS = ['www.wadhefa.com', 'www.ewdifh.com']; // مواقع صغيرة، rate-limit صارم
    const domainLimiters = new Map();
    const limitByDomain = url => {
      let host;
      try { host = new URL(url).hostname; } catch { host = 'unknown'; }
      if (!domainLimiters.has(host)) domainLimiters.set(host, pLimit(FRAGILE_HOSTS.includes(host) ? 1 : 2));
      return { limiter: domainLimiters.get(host), fragile: FRAGILE_HOSTS.includes(host) };
    };
    const startId = analyzedJobs.length;

    await Promise.all(
      browserLinks.slice(0, MAX_AI_LINKS).map((url, idx) => {
        const { limiter, fragile } = limitByDomain(url);
        return limitAI(() => limiter(async () => {
          const jobId = startId + idx + 1;
          try {
            console.log(`📥 [${jobId}] Fetching ${url.slice(0, 90)}...`);
            await sleep(fragile ? rand(1500, 3000) : rand(150, 450)); // تهدئة أكبر لمواقع صغيرة حساسة

            let html;
            try {
              html = await fetchHtmlWithRetry(url);
            } catch (err) {
              throw new Error(`[fetch-html] ${err.message}`);
            }

            let res;
            try {
              res = await callAI({
                system: JOB_EXTRACT_PROMPT,
                user: buildJobPrompt(url, html),
                expectJson: true
              });
            } catch (err) {
              throw new Error(`[nvidia-ai] ${err.message}`);
            }

            const parsed = safeJsonParse(res);
            parsed.job_id = jobId;
            parsed.job_url = parsed.job_url || url;

            // رابط التقديم الحقيقي (المنصة المدموجة داخل الإعلان) — لا نثق بالـ AI هنا،
            // نستخرجه حتمياً من HTML الكامل ونحلّ المختصرات (lik.ad -> jadarat.sa ...).
            // يخصّ ewdifh غالباً؛ لو ما لقى شيء يرجّع null ونستخدم رابط الإعلان كبديل.
            try {
              const applyUrl = await getApplyUrl(html);
              if (applyUrl && applyUrl !== parsed.job_url) parsed.apply_url = applyUrl;
            } catch {}

            parsed.source =
              (url.includes('naukrigulf') && 'naukrigulf') ||
              (url.includes('wadhefa') && 'wadhefa') ||
              (url.includes('ewdifh') && 'ewdifh') ||
              (url.includes('sabbar') && 'sabbar') ||
              'google';
            analyzedJobs.push(parsed);
            console.log(`✅ [${jobId}] Analyzed: ${parsed.job_title || url}\n`);
          } catch (err) {
            console.warn(`⚠️ [${jobId}] Skip ${url}: ${err.message}\n`);
          }
        }));
      })
    );
  }

  analyzedJobs.sort((a, b) => (a.job_id || 0) - (b.job_id || 0));

  const beforeLocFilter = analyzedJobs.length;
  const filtered = analyzedJobs.filter(j => {
    const isSaudi = j.is_saudi_based === true || isSaudiLocation(j.location) || isSaudiLocation(j.location_ar);
    const sectorOk = j.is_government === true || passesSectorRule({
      company: j.company, sector: j.sector, title: j.job_title, titleAr: j.job_title_ar,
      description: j.description, descriptionAr: j.description_ar
    });
    return isSaudi && sectorOk;
  });
  console.log(`📝 Total analyzed: ${beforeLocFilter} -> ${filtered.length} بعد فلترة "سعودية + (حكومي أي مجال / خاص: تقنية أو QA-QC أو ذكاء اصطناعي أو أمن سيبراني أو علاقات عامة أو إعلام)" (استبعدنا ${beforeLocFilter - filtered.length})\n`);

  // الفلتر المركزي القوي: نافذة "اليوم+أمس" + ديدوب داخل التشغيل + ديدوب عبر التشغيلات
  const { kept, stats } = filterJobs(filtered, seen, NOW);
  console.log(`🎯 فلترة زمنية+تكرار: ${stats.total} → ${stats.kept} (قديمة خارج النافذة: ${stats.stale} | مكرر داخل التشغيل: ${stats.dupInRun} | مكرر من تشغيل سابق: ${stats.dupSeen})\n`);

  // نسجّل كل وظيفة مقبولة كمُعالَجة حتى لا تتكرر في التشغيلات القادمة
  kept.forEach(j => seen.add(j, new Date(NOW).toISOString()));
  try { seen.save(); } catch (e) { console.warn(`⚠️ seen-store save failed: ${e.message}`); }

  analyzedJobs.length = 0;
  analyzedJobs.push(...kept);

  if (!analyzedJobs.length) {
    console.log('❌ ولا وظيفة تقنية داخل السعودية بعد الفلترة. Bye.');
    return;
  }

  /* ---------- 4) أهم الوظائف ---------- */
  let importantJobs = [];
  try {
    const r = await callAI({
      system: AGG_JOB_PROMPT,
      user: JSON.stringify({ Jobs: analyzedJobs }).slice(0, 28000),
      expectJson: true
    });
    const parsed = safeJsonParse(r);
    const rawImportant = Array.isArray(parsed.important_jobs) ? parsed.important_jobs : [];

    // لا نثق برابط تكتبه الـ AI يدوياً (لاحظنا حالات ربط رابط وظيفة بعنوان وظيفة ثانية) —
    // بدل ذلك نطابق source_job_id مع القائمة الأصلية ونجيب الرابط الصحيح مضمون 100%
    const byId = new Map(analyzedJobs.map(j => [j.job_id, j]));
    importantJobs = rawImportant
      .map((it, i) => {
        const orig = byId.get(it.source_job_id);
        if (!orig) {
          console.warn(`⚠️ important_jobs: source_job_id ${it.source_job_id} not found, dropping "${it.important_title}"`);
          return null;
        }
        // نفضّل رابط التقديم المباشر للمنصة (apply_url)؛ رابط إعلان ewdifh بديل فقط
        return { ...it, important_job_id: i + 1, important_url: orig.apply_url || orig.job_url, source_url: orig.job_url };
      })
      .filter(Boolean)
      .slice(0, 10);

    console.log(`⭐ Important jobs = ${importantJobs.length}\n`);
  } catch (e) {
    console.warn(`⚠️ important_jobs failed: ${e.message}`);
  }

  // بديل بدون AI: لو فشل التجميع (429/انقطاع) أو رجّع فاضي، ننتقي محلياً
  // حتى لا يتعطّل النشر بالكامل بسبب استدعاء ذكاء اصطناعي واحد.
  if (!importantJobs.length && analyzedJobs.length) {
    importantJobs = buildFallbackImportant(analyzedJobs, 10);
    console.log(`🛟 تعذّر تجميع الـAI — انتقينا ${importantJobs.length} وظيفة محلياً (بديل مضمون النشر)\n`);
  }

  const outFile = `jobs-${timestamp}.json`;
  fs.writeFileSync(outFile, JSON.stringify({ Jobs: analyzedJobs, important_jobs: importantJobs }, null, 2), 'utf8');
  console.log(`✅ Saved ${outFile}`);
  console.log(`📊 Total jobs: ${analyzedJobs.length} | ⭐ Important: ${importantJobs.length}`);

  /* ---------- 5) إرسال تيليجرام ---------- */
  if (ENABLE_TELEGRAM && importantJobs.length) {
    console.log('\n📤 Sending important jobs to Telegram...');
    const result = await sendJobsToTelegram(importantJobs);
    console.log(`✅ Telegram: sent=${result.sent} already-posted=${result.alreadyPosted} failed=${result.skipped}`);
  }

  console.log('\n🏁 Done');
})();

/* ===================== API SOURCES COLLECTOR ===================== */
function hasKeyFor(name) {
  const map = {
    adzuna: ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'],
    jooble: ['JOOBLE_KEY'],
    findwork: ['FINDWORK_KEY'],
    careerjet: ['CAREERJET_AFFID'],
    jsearch: ['JSEARCH_RAPIDAPI_KEY']
  };
  return (map[name] || []).every(k => !!process.env[k]);
}

async function collectFromAPIs(keywords, sources) {
  const limit = pLimit(API_PARALLEL);
  const all = [];
  const tasks = [];

  for (const kw of keywords) {
    for (const src of sources) {
      tasks.push(limit(async () => {
        try {
          const rows = await src.fn(kw);
          if (rows.length) {
            console.log(`   ✓ [${src.name}] "${kw}" -> ${rows.length}`);
            all.push(...rows);
          }
        } catch (e) {
          const code = e.response?.status || e.code || e.message;
          console.warn(`   ⚠️ [${src.name}] "${kw}" skipped (${code})`);
        }
      }));
    }
  }

  await Promise.all(tasks);

  const seen = new Set();
  const deduped = [];
  for (const j of all) {
    const key = (j.job_url || '').split('#')[0];
    if (key && !seen.has(key)) { seen.add(key); deduped.push(j); }
  }
  return deduped;
}

function apiToSchema(j, id) {
  return {
    job_id: id,
    source: j.source,
    job_url: j.job_url,
    job_title: j.job_title,
    job_title_ar: '',
    company: j.company,
    location: j.location,
    location_ar: '',
    job_type: j.is_remote ? 'عن بعد' : 'غير محدد',
    sector: 'أخرى',
    experience_level: 'غير محدد',
    salary: j.salary,
    description: j.description,
    description_ar: '',
    requirements: [],
    benefits: [],
    posted_date: j.posted_date,
    application_deadline: 'unknown',
    is_saudi_based: /saudi|riyadh|jeddah|dammam|السعودية|الرياض/i.test(`${j.location}`),
    is_remote: j.is_remote
  };
}

/* ===================== BROWSER SCRAPE (Google + Naukrigulf) ===================== */
async function runBrowserScrape() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    defaultViewport: { width: 1366, height: 900 }
  });

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(45000);
  page.setDefaultTimeout(20000);

  try {
    await page.setUserAgent(UA_STR);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8' });

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'language', { get: () => 'en-US' });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'ar'] });
      if (!window.chrome) window.chrome = { runtime: {} };
      const originalQuery = window.navigator.permissions?.query;
      if (originalQuery) {
        window.navigator.permissions.query = parameters =>
          parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery(parameters);
      }
    });

    const allLinks = new Set();

    if (ENABLE_GOOGLE) {
      await page.goto('https://www.google.com/ncr', { waitUntil: 'domcontentloaded' });
      await handleConsent(page);

      for (const kw of GOOGLE_QUERIES) {
        const links = await scrapeGoogleKeyword(page, kw);
        links.forEach(l => allLinks.add(l));
        console.log(`>>> [google] ${kw} (count = ${links.length})`);
      }
    }

    if (ENABLE_NAUKRIGULF) {
      for (const kw of JOB_KEYWORDS) {
        const links = await scrapeNaukrigulf(page, kw);
        links.forEach(l => allLinks.add(l));
        console.log(`>>> [naukrigulf] ${kw} (count = ${links.length})`);
      }
    }

    return [...allLinks];
  } finally {
    try { await browser.close(); } catch {}
  }
}

/* ===================== GOOGLE HELPERS ===================== */
function buildJobSearchUrl(keyword, pageNum = 1) {
  const start = (pageNum - 1) * 10;
  const params = new URLSearchParams({
    q: keyword, start: String(start), num: '10', hl: GOOGLE_LANG, gl: GOOGLE_REGION
  });
  return `https://www.google.com/search?${params.toString()}`;
}

async function scrapeGoogleKeyword(pg, keyword) {
  const acc = new Set();

  for (let p = 1; p <= MAX_PAGES; p++) {
    try {
      const url = buildJobSearchUrl(keyword, p);
      console.log(`→ [${keyword}] Page ${p}: ${url}`);

      await sleep(rand(1800, 3500));
      await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(rand(800, 1500));
      await humanize(pg);

      const bodyText = await pg.evaluate(() => document.body?.innerText?.toLowerCase() || '');
      if (bodyText.includes('unusual traffic') || bodyText.includes('captcha') || bodyText.includes('not a robot')) {
        console.warn(`⚠️ Blocking/CAPTCHA detected on page ${p}`);
        await pg.screenshot({ path: `blocked-${slug(keyword)}-page${p}.png`, fullPage: true });
        break;
      }

      const hasSearch = await pg.$('#search');
      if (!hasSearch) {
        console.warn(`⚠️ Search container not found on page ${p}`);
        break;
      }

      const pageLinks = await pg.$$eval('#search a[href]', anchors =>
        [...new Set(anchors.map(a => a.href).filter(Boolean).filter(href => href.startsWith('http')))]
      );

      const jobLinks = pageLinks.map(stripTracking).filter(isLikelyJobLink);
      console.log(`✓ Found ${jobLinks.length} candidate job links on page ${p}`);
      jobLinks.forEach(link => acc.add(link));

      const nextBtn =
        (await pg.$('a#pnnext')) ||
        (await pg.$('a[aria-label="Next"]')) ||
        (await pg.$('a[aria-label="التالي"]'));
      if (!nextBtn) break;

      await sleep(rand(2000, 4000));
    } catch (err) {
      console.warn(`⚠️ Error on [${keyword}] page ${p}: ${err.message}`);
      break;
    }
  }

  return [...acc];
}

function isLikelyJobLink(h) {
  const s = h.toLowerCase();
  if (s.includes('google.com') || s.includes('/search?') || s.includes('webcache') ||
      s.includes('policies.google') || s.includes('support.google')) return false;
  return (
    s.includes('/job') || s.includes('/jobs') || s.includes('career') || s.includes('careers') ||
    s.includes('linkedin.com/jobs') || s.includes('indeed.') || s.includes('bayt.com') ||
    s.includes('naukrigulf.com') || s.includes('glassdoor.') || s.includes('greenhouse.io') ||
    s.includes('lever.co')
  );
}

function stripTracking(u) {
  try {
    const url = new URL(u);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'mc_cid', 'mc_eid', 'ref', 'source']
      .forEach(k => url.searchParams.delete(k));
    url.hash = ''; // يمنع تكرار نفس الرابط بسبب #:~:text= من جوجل
    return url.toString();
  } catch { return u; }
}

async function handleConsent(pg) {
  try {
    const selectors = [
      'button#L2AGLb', 'button[aria-label*="Accept"]', 'button[aria-label*="Agree"]',
      '::-p-text(Accept all)', '::-p-text(I agree)', '::-p-text(موافق)', '::-p-text(قبول الكل)'
    ];
    for (const sel of selectors) {
      try {
        const btn = await pg.$(sel);
        if (btn) { await btn.click(); await sleep(1500); return true; }
      } catch {}
    }
  } catch {}
  return false;
}

async function humanize(pg) {
  try {
    await pg.mouse.move(rand(50, 300), rand(80, 250), { steps: rand(8, 20) });
    await sleep(rand(200, 700));
    await pg.evaluate(y => window.scrollBy(0, y), rand(100, 350));
    await sleep(rand(300, 900));
  } catch {}
}

/* ===================== MISC HELPERS ===================== */
async function fetchHtmlWithRetry(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await axios.get(url, {
        timeout: 20000, headers: UA, maxRedirects: 5,
        validateStatus: s => s >= 200 && s < 400
      });
      return resp.data;
    } catch (err) {
      const status = err.response?.status;
      if (status === 429 && i < retries) {
        const wait = 5000 * (i + 1);
        console.log(`⏳ 429 من ${new URL(url).hostname}, إعادة محاولة بعد ${wait}ms`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
}

function buildJobPrompt(url, html) {
  return `
TASK:
1. You will get: (a) the URL of a job page, (b) its raw HTML.
2. Extract the required fields and output EXACTLY the schema provided.

DATA:
URL: ${url}
HTML: """${String(html).slice(0, 9000)}"""
(HTML truncated to 9,000 chars)
`;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function slug(s) { return String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, ''); }

/* ===================== PROMPTS ===================== */
const JOB_EXTRACT_PROMPT = `
You are an expert job extraction analyst.
Return STRICTLY a JSON object matching the schema below. No markdown, no extra keys.

SCHEMA TO OUTPUT EXACTLY:
{
  "job_id": 0,
  "job_url": "<URL>",
  "job_title": "<English job title>",
  "job_title_ar": "<عنوان الوظيفة بالعربية>",
  "company": "<company name>",
  "location": "<location>",
  "location_ar": "<الموقع بالعربية>",
  "job_type": "دوام كامل|دوام جزئي|عقد|تدريب|عن بعد",
  "sector": "التقنية|ضمان وضبط الجودة|الذكاء الاصطناعي|الأمن السيبراني|العلاقات العامة|الإعلام والبث|الطاقة|الهندسة|الإدارة|حكومي|أخرى",
  "experience_level": "مبتدئ|متوسط|متقدم|تنفيذي",
  "salary": "<if available, else 'غير محدد'>",
  "description": "<brief English description max 300 chars>",
  "description_ar": "<وصف مختصر بالعربية>",
  "requirements": ["<req1>", "<req2>", "<req3>"],
  "benefits": ["<benefit1>", "<benefit2>"],
  "posted_date": "<if visible, else 'unknown'>",
  "application_deadline": "<if visible, else 'unknown'>",
  "is_saudi_based": true,
  "is_remote": false,
  "is_government": false
}
`;

const AGG_JOB_PROMPT = `
You are a senior recruitment consultant. All jobs in the input are already confirmed to be based in Saudi Arabia (any region/city) and pre-filtered by sector rule: government jobs (any field) OR private-sector jobs limited to tech / QA-QC (quality assurance & control, testing) / AI & machine learning / cyber security / public relations / broadcasting (TV & radio) / media. Marketing is NOT a target sector — do not select marketing jobs. Select up to 10 most important/attractive jobs from the given Jobs array.

Prioritize:
- Senior/executive roles
- Competitive salaries
- Reputable companies/entities (government or private)
- Try to represent different Saudi cities/regions when quality allows (not only Riyadh)
- Try to represent a mix of sectors (not only tech) when quality allows

IMPORTANT: "source_job_id" MUST be the exact integer "job_id" of the job you picked from the input array. Do NOT invent or copy any URL yourself — the URL will be looked up programmatically from source_job_id.

OUTPUT
------
Return STRICTLY this structure—no markdown, no extra keys:
{
  "important_jobs": [
    {
      "source_job_id": 0,
      "important_title": "<English job title>",
      "important_title_ar": "<عنوان الوظيفة بالعربية>",
      "important_company": "<company>",
      "important_location": "<location>",
      "important_job_type": "<job_type from input, else 'غير محدد'>",
      "important_salary": "<salary from input, else 'غير محدد'>",
      "important_description_ar": "<وصف بالعربية، جملتين>",
      "why_important": "<برّر الاختيار بإيجاز بالعربية>"
    }
  ]
}
`;
