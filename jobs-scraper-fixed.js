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
import { passesSectorRule, isGraduateProgram } from './lib/sectors.js';
import { verifySoftwareQa } from './lib/qaClassifier.js';
import { API_SOURCES, GLOBAL_REMOTE_SOURCES } from './sources/apiSources.js';
import { scrapeNaukrigulf } from './sources/naukrigulf.js';
import { fetchWadhefa, fetchEwdifh, fetchSabbar } from './sources/saudiSites.js';
import { fetchNaukrigulfApiJobs } from './sources/naukrigulfApi.js';
import { fetchAtsBoards } from './sources/atsBoards.js';
import { fetchLinkedinJobs } from './sources/linkedin.js';
import { fetchEntityJobs } from './sources/entityJobs.js';
import { fetchJobsArab, enrichJobsArab } from './sources/jobsArab.js';
import { fetchYahooLinks } from './sources/yahooSearch.js';
import { buildFallbackImportant } from './lib/importantFallback.js';
import { buildSmartQueries } from './lib/queryBuilder.js';
import { getApplyUrl } from './lib/applyLink.js';
import { SeenStore } from './lib/seenStore.js';
import { filterJobs } from './lib/jobFilter.js';
import { config as dateWindowConfig } from './lib/dateWindow.js';
import { sendRunReport, notifyAdminError, adminConfigured } from './lib/adminNotify.js';

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
// مراقبة الجهات شبه الحكومية (entities.json) — كل إعلاناتها لا الكلمات المفتاحية
const ENABLE_ENTITIES = String(process.env.ENABLE_ENTITIES || 'true').toLowerCase() === 'true';
const ENABLE_JOBS_ARAB = String(process.env.ENABLE_JOBS_ARAB || 'true').toLowerCase() === 'true';
const ENABLE_ATS = String(process.env.ENABLE_ATS || 'true').toLowerCase() === 'true';
const ENABLE_GLOBAL_REMOTE_APIS = String(process.env.ENABLE_GLOBAL_REMOTE_APIS || 'false').toLowerCase() === 'true';
const ENABLE_TELEGRAM = String(process.env.ENABLE_TELEGRAM || 'true').toLowerCase() === 'true';
// بوابة AI اللي تتأكد إن الوظيفة QA برمجيات لا جودة ميدانية — أطفئها لو حد معدل
// NVIDIA ضيّق وتبي تعتمد على الفلتر النصي وحده
const ENABLE_AI_QA_GATE = String(process.env.ENABLE_AI_QA_GATE || 'true').toLowerCase() === 'true';
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

let JOB_KEYWORDS = [];   // تُستبدل بالشريحة المدوَّرة بعد التحميل
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
  // ملف الكلمات تالف أو مفقود = البوت ميت تماماً. لازم يعرف الأدمن فوراً.
  await notifyAdminError(`تعذّر تحميل ${KEYWORDS_FILE}`, err).catch(() => {});
  process.exit(1);
}

/* ---------- تدوير الكلمات عبر التشغيلات ---------- */
// مع التشغيل كل ساعتين (١٢ مرة يومياً) لازم تنزل الشريحة من ١٢ إلى ٨ كلمات حتى
// يبقى الحِمل اليومي على لنكدإن عند المستوى المجرَّب والآمن نفسه:
//   قبل: 8 تشغيلات × 12 كلمة =  96 استدعاء/يوم  (كل ٣ ساعات)
//   بعد: 12 تشغيلة × 8 كلمات =  96 استدعاء/يوم  (كل ساعتين — نفس الحِمل تماماً)
// وتُغطّى كل الكلمات كل ١٠ ساعات (٥ شرائح × ساعتين). تمريرة الطازج (f_TPR=r86400)
// تضمن عدم ضياع إعلان: أي إعلان يُنشر لكلمة معيّنة يُلتقط خلال ≤١٠ ساعات وهو
// داخل نافذة الـ٢٤ ساعة دائماً.
// التدوير مشتق من ساعة الرياض لا من عدّاد محفوظ: بلا حالة، ويصحّ حتى لو فاتت تشغيلة.
// KEYWORD_SLICE=0 يعطّل التدوير ويمرّر كل الكلمات (للتشغيل اليدوي/التشخيص).
const KEYWORD_SLICE = Number(process.env.KEYWORD_SLICE ?? 8);

function rotateKeywords(all) {
  if (!KEYWORD_SLICE || KEYWORD_SLICE >= all.length) return all;
  const riyadhHour = Number(new Date(Date.now() + 3 * 3600e3).toISOString().slice(11, 13));
  const slot = Math.floor(riyadhHour / 2);                      // 0..11 (تشغيلة كل ساعتين)
  const windows = Math.ceil(all.length / KEYWORD_SLICE);
  const offset = (slot % windows) * KEYWORD_SLICE;
  // نلتف حول نهاية المصفوفة حتى تبقى الشريحة ممتلئة دائماً
  const out = [];
  for (let i = 0; i < KEYWORD_SLICE; i++) out.push(all[(offset + i) % all.length]);
  return [...new Set(out)];
}

const ALL_KEYWORDS = JOB_KEYWORDS;
JOB_KEYWORDS = rotateKeywords(ALL_KEYWORDS);
if (JOB_KEYWORDS.length < ALL_KEYWORDS.length) {
  console.log(`🔄 تدوير الكلمات: ${JOB_KEYWORDS.length}/${ALL_KEYWORDS.length} لهذه التشغيلة (الدورة الكاملة كل ${Math.ceil(ALL_KEYWORDS.length / KEYWORD_SLICE) * 2} ساعات) — ${JOB_KEYWORDS.slice(0, 3).join(' · ')} …`);
}

// استعلامات جوجل "الذكية": نفس المسميات + مدن سعودية فعلية (مثل "node js developer Riyadh")
// بدل "Saudi Arabia" العامة بس. Naukrigulf/wadhefa يستخدمون JOB_KEYWORDS الخام
// (Naukrigulf يشيل أسماء المدن من الاستعلام أصلاً، فالدمج معه بلا فايدة).
const CITIES_PER_ROLE = Number(process.env.SMART_QUERY_CITIES_PER_ROLE || 2);
const GOOGLE_QUERIES = buildSmartQueries(JOB_KEYWORDS, { citiesPerRole: CITIES_PER_ROLE });
console.log(`🧠 Built ${GOOGLE_QUERIES.length} smart Google queries from ${JOB_KEYWORDS.length} roles (${CITIES_PER_ROLE} cities/role)`);

/* ---------- نطاق القبول الموحّد ---------- */
// المجالات الأربعة لكل المصادر، *بالإضافة* إلى برامج الخريجين والتدريب والابتعاث
// لكن من الجهات المُراقَبة وحدها (source === 'linkedin-entity'). ليش التقييد:
// مسمّيات البرامج بلا إشارة تقنية، فقبولها من أي مصدر كان بيغرق القناة بإعلانات
// تدريب عامة لا علاقة لها بمجالك.
function inTargetScope(j) {
  const fields = {
    company: j.company, sector: j.sector, title: j.job_title, titleAr: j.job_title_ar,
    description: j.description, descriptionAr: j.description_ar, requirements: j.requirements
  };
  if (passesSectorRule(fields)) return true;
  if (j.source === 'linkedin-entity' && isGraduateProgram(j.job_title, j.job_title_ar)) {
    j.is_program = true;              // نوسمها عشان تبان في الرسالة والتقرير
    return true;
  }
  return false;
}

/* ============================== MAIN ============================== */
// إحصاءات تُجمَّع أثناء التشغيلة وتُرسل للأدمن في التقرير
const runStats = { collected: null, inScope: null, stale: null, aiRejected: 0 };

(async function main() {
  console.log('▶️ Start job scraping\n');

  // مخزن الوظائف المُعالَجة سابقاً (ديدوب عبر التشغيلات) + وقت مرجعي ثابت للتشغيل كامل
  const NOW = Date.now();
  const seen = new SeenStore();
  console.log(`🗂️ Seen-store: ${seen.size} مفتاح محفوظ | نافذة القبول: ${dateWindowConfig.WINDOW_HOURS > 0 ? `آخر ${dateWindowConfig.WINDOW_HOURS} ساعة (متدحرجة)` : (dateWindowConfig.WINDOW_DAYS === 1 ? "اليوم فقط" : `آخر ${dateWindowConfig.WINDOW_DAYS} يوم`)}${dateWindowConfig.DROP_UNKNOWN ? ' | إسقاط التواريخ المجهولة' : ''}\n`);

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

    // لوحات ATS للشركات (Greenhouse/Workable/Recruitee/...) — JSON عام بلا مفتاح
    // ولا يمرّ عبر Cloudflare حق مواقع الوظائف، فما يتأثر بالحجب. بلا AI.
    if (ENABLE_ATS) {
      try {
        const atsJobs = await fetchAtsBoards();
        const known = new Set(apiJobs.map(j => (j.job_url || '').split('?')[0]));
        for (const j of atsJobs) {
          const key = (j.job_url || '').split('?')[0];
          if (key && !known.has(key)) { known.add(key); apiJobs.push(j); }
        }
      } catch (e) {
        console.warn(`   ⚠️ [ats] failed: ${e.message}`);
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

    // الجهات شبه الحكومية والهيئات: نراقب صفحاتها على لنكدإن بالكامل (f_C) لا
    // بالكلمات المفتاحية — عشان نلتقط برامج الخريجين والتدريب والابتعاث اللي
    // مسمّياتها ما فيها كلمة تقنية فتفوت مسار الكلمات.
    if (ENABLE_ENTITIES) {
      try {
        const entJobs = await fetchEntityJobs();
        const known = new Set(apiJobs.map(j => (j.job_url || '').split('?')[0]));
        for (const j of entJobs) {
          const key = (j.job_url || '').split('?')[0];
          if (key && !known.has(key)) { known.add(key); apiJobs.push(j); }
        }
      } catch (e) {
        console.warn(`   ⚠️ [entities] failed: ${e.message}`);
      }
    }

    const beforeFilter = apiJobs.length;
    apiJobs = apiJobs.filter(j =>
      isSaudiLocation(j.location) && inTargetScope(j)
    );
    console.log(`📦 API jobs: ${beforeFilter} -> ${apiJobs.length} بعد فلترة "سعودية + النطاقات الأربعة" (استبعدنا ${beforeFilter - apiJobs.length})\n`);

    // إثراء وظائف العرب من صفحاتها — بعد الفلترة عشان نجيب الباقية فقط
    // (٥٥ وظيفة من الخلاصة تنزل لعشرات قليلة هنا، فنوفّر طلبات ونحترم حد المعدل).
    if (ENABLE_JOBS_ARAB) {
      try {
        apiJobs = await enrichJobsArab(apiJobs);
      } catch (e) {
        console.warn(`   ⚠️ [jobs-arab] الإثراء فشل: ${e.message}`);
      }
    }
  }

  /* ---------- 2) جوجل + Naukrigulf (عبر متصفح) ---------- */
  let browserLinks = [];
  if (ENABLE_GOOGLE || ENABLE_NAUKRIGULF) {
    // فشل إطلاق كروميوم كان يسقط التشغيلة كلها ويرمي وظائف مسار apiJobs المجموعة
    // أصلاً (شفناها: TimeoutError على WS endpoint تحت ضغط ذاكرة على راسبيري باي).
    // مسار المتصفح مجرد إضافة، فنكمل بدونه بدل ما نخسر التشغيلة.
    try {
      browserLinks = await runBrowserScrape();
    } catch (e) {
      console.warn(`⚠️ [browser] تخطّينا مسار المتصفح: ${e.message.split('\n')[0]}`);
    }
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
    await reportToAdmin({ sent: 0, stats: runStats });
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
  // ملاحظة: الوظيفة الحكومية ما لها استثناء بعد تضييق النطاق (2026-08-08) — كان
  // `j.is_government === true` يتجاوز فلتر المجال كلياً فيمرّر أي وظيفة حكومية.
  const filtered = analyzedJobs.filter(j => {
    const isSaudi = j.is_saudi_based === true || isSaudiLocation(j.location) || isSaudiLocation(j.location_ar);
    return isSaudi && inTargetScope(j);
  });
  runStats.collected = beforeLocFilter;
  console.log(`📝 Total analyzed: ${beforeLocFilter} -> ${filtered.length} بعد فلترة "سعودية + النطاقات الأربعة" (استبعدنا ${beforeLocFilter - filtered.length})\n`);

  // الفلتر المركزي القوي: نافذة "اليوم+أمس" + ديدوب داخل التشغيل + ديدوب عبر التشغيلات
  const { kept, stats } = filterJobs(filtered, seen, NOW);
  runStats.inScope = filtered.length;
  runStats.stale = stats.stale;
  console.log(`🎯 فلترة زمنية+تكرار: ${stats.total} → ${stats.kept} (قديمة خارج النافذة: ${stats.stale} | مكرر داخل التشغيل: ${stats.dupInRun} | مكرر من تشغيل سابق: ${stats.dupSeen})`);
  if (stats.stale) {
    const ages = Object.entries(stats.staleAges)
      .sort((a, b) => (parseInt(a[0]) || 999) - (parseInt(b[0]) || 999))
      .map(([k, v]) => `${k}:${v}`).join(' · ');
    console.log(`   ↳ أعمار المرفوضات زمنياً (النافذة = ${dateWindowConfig.WINDOW_DAYS}ي): ${ages}`);
  }
  console.log('');

  // نسجّل كل وظيفة مقبولة كمُعالَجة حتى لا تتكرر في التشغيلات القادمة
  kept.forEach(j => seen.add(j, new Date(NOW).toISOString()));
  try { seen.save(); } catch (e) { console.warn(`⚠️ seen-store save failed: ${e.message}`); }

  // بوابة AI أخيرة: تستبعد اللي عدّى الـregex وهو مو QA برمجيات (جودة إنشاءات/مصانع/ISO).
  // بعد الفلتر الزمني عمداً — عدد أقل من الوظائف = استدعاءات أقل ضد حد المعدل.
  // برامج الجهات المُراقَبة تتخطّى البوابة: موجّهها يقبل المجالات الأربعة فقط
  // فكان بيرفض "برنامج تطوير الخريجين" حتماً. ضمانتها أنها من جهة في entities.json
  // ومسمّاها برنامج صريح — وهذان شرطان تحقّقا قبل الوصول هنا.
  const programs = kept.filter(j => j.is_program);
  const needGate = kept.filter(j => !j.is_program);

  let verifiedQa = kept;
  if (ENABLE_AI_QA_GATE && needGate.length) {
    const { kept: aiKept, dropped, aiFailed } = await verifySoftwareQa(needGate);
    verifiedQa = [...aiKept, ...programs];
    console.log(
      `🤖 بوابة AI (النطاقات الأربعة): ${needGate.length} → ${aiKept.length}` +
      ` (استبعدنا ${dropped.length}${aiFailed ? ' — بعض الدفعات فشلت ومُرّرت بالفلتر النصي' : ''})` +
      `${programs.length ? ` | ${programs.length} برنامج جهة تخطّى البوابة` : ''}\n`
    );
    runStats.aiRejected = dropped.length;
    dropped.forEach(j => console.log(`   ⛔ AI رفض: ${j.job_title || j.job_title_ar || j.job_url}`));
  }

  analyzedJobs.length = 0;
  analyzedJobs.push(...verifiedQa);

  if (!analyzedJobs.length) {
    console.log('❌ ولا وظيفة داخل النطاقات المستهدفة في السعودية بعد الفلترة. Bye.');
    await reportToAdmin({ sent: 0, stats: runStats });
    return;
  }

  /* ---------- 4) أهم الوظائف ---------- */
  let importantJobs = [];
  try {
    // حمولة منحّفة: نرسل الحقول اللي يحتاجها الاختيار فقط، والوصف مقصوص.
    // بعد إثراء وصف لنكدإن صار كل إعلان يحمل حتى ٤٠٠٠ حرف، فحمولة ٢٨ ألف حرف
    // كانت تُقصّ عشوائياً في منتصف JSON (فيفشل التحليل) أو يبطؤ الرد حتى المهلة.
    const slim = analyzedJobs.map(j => ({
      job_id: j.job_id,
      job_title: j.job_title,
      job_title_ar: j.job_title_ar,
      company: j.company,
      location: j.location,
      job_type: j.job_type,
      salary: j.salary,
      experience_level: j.experience_level,
      is_remote: j.is_remote,
      description: String(j.description || j.description_ar || '').replace(/\s+/g, ' ').slice(0, 300)
    }));
    const r = await callAI({
      system: AGG_JOB_PROMPT,
      user: JSON.stringify({ Jobs: slim }).slice(0, 28000),
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
  let tgResult = { sent: 0, alreadyPosted: 0, skipped: 0 };
  if (ENABLE_TELEGRAM && importantJobs.length) {
    console.log('\n📤 Sending important jobs to Telegram...');
    tgResult = await sendJobsToTelegram(importantJobs);
    console.log(`✅ Telegram: sent=${tgResult.sent} already-posted=${tgResult.alreadyPosted} failed=${tgResult.skipped}`);
  }

  // تقرير الأدمن — بعد النشر حتى يحمل العدد الفعلي المُرسَل لا المُختار
  await reportToAdmin({
    sent: tgResult.sent,
    alreadyPosted: tgResult.alreadyPosted,
    failed: tgResult.skipped,
    stats: { ...runStats, aiRejected: runStats.aiRejected },
    titles: importantJobs.map(j => `${j.important_title}${j.important_company ? ' — ' + j.important_company : ''}`)
  });

  console.log('\n🏁 Done');
})();

// غلاف يمنع فشل التنبيه من إسقاط تشغيلة ناجحة
async function reportToAdmin(payload) {
  try {
    const ok = await sendRunReport(payload);
    if (ok) console.log('📨 أُرسل تقرير التشغيلة للأدمن');
  } catch (e) {
    console.warn(`⚠️ تقرير الأدمن فشل: ${e.message}`);
  }
}

/* ---------- تنبيه الأدمن عند أي انهيار غير متوقّع ---------- */
// التشغيلة الإنتاجية 2026-08-08 طاحت بأثر Node قاتل وما دُرِي إلا بقراءة السجل
// يدوياً. هذي المصائد تضمن وصول الخبر فوراً.
let crashReported = false;
async function reportCrash(context, err) {
  if (crashReported) return;                 // تنبيه واحد يكفي
  crashReported = true;
  console.error(`💥 ${context}: ${err?.stack || err}`);
  try { await notifyAdminError(context, err); } catch {}
}

process.on('unhandledRejection', async (err) => {
  await reportCrash('وعد مرفوض بلا معالجة (unhandledRejection)', err);
  process.exit(1);
});
process.on('uncaughtException', async (err) => {
  await reportCrash('استثناء غير ملتقط (uncaughtException)', err);
  process.exit(1);
});

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
    // نفضّل نوع الدوام القادم من المصدر (الإثراء يوفّره) قبل ما نستنتجه من is_remote
    job_type: j.job_type || (j.is_remote ? 'عن بعد' : 'غير محدد'),
    sector: j.section || 'أخرى',
    experience_level: 'غير محدد',
    salary: j.salary,
    description: j.description,
    description_ar: '',
    requirements: [],
    benefits: [],
    posted_date: j.posted_date,
    application_deadline: j.valid_through || 'unknown',
    is_saudi_based: /saudi|riyadh|jeddah|dammam|السعودية|الرياض/i.test(`${j.location}`),
    is_remote: j.is_remote
  };
}

/* ===================== BROWSER SCRAPE (Google + Naukrigulf) ===================== */
async function runBrowserScrape() {
  const browser = await puppeteer.launch({
    headless: true,
    // --disable-dev-shm-usage + مهلة أطول: كروميوم على راسبيري باي يبدأ ببطء تحت
    // الضغط وكان يفشل على مهلة الـ30 ثانية الافتراضية.
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
    timeout: Number(process.env.PUPPETEER_LAUNCH_TIMEOUT_MS || 120000),
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
  "sector": "جودة البرمجيات|جودة إنشاءات ومواقع|جودة تصنيع ومصانع|جودة أغذية ومختبرات|تقنية غير جودة|أخرى",
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
  "is_government": false,
  "is_software_qa": false
}

"sector" rules — pick the one that matches where the quality/testing work actually happens:
- "جودة البرمجيات" ONLY when the role tests software: web apps, websites, mobile apps,
  APIs, backend systems, digital platforms (QA Engineer, SDET, Software Tester, Test
  Automation Engineer, QA Analyst).
- "جودة إنشاءات ومواقع" for civil/construction QA-QC, site or welding or NDT inspection.
- "جودة تصنيع ومصانع" for factory, production line, refinery, oil & gas quality.
- "جودة أغذية ومختبرات" for food, pharmaceutical, chemical, or physical laboratory quality.
- "تقنية غير جودة" for technical roles that are not QA/testing (developer, DevOps, data, AI, security).
- "أخرى" for anything else.

"is_software_qa" must be true ONLY when sector is "جودة البرمجيات". If you cannot confirm
the quality/testing work targets software, set it false.
`;

const AGG_JOB_PROMPT = `
You are a senior recruitment consultant. All jobs in the input are already confirmed to be based in Saudi Arabia (any region/city) and pre-filtered to FOUR technology domains only:
1. SOFTWARE QA / QC — testing of software: web apps, websites, mobile apps, APIs, backend systems (QA Engineer, QA Analyst, SDET, Software Tester, Test Automation Engineer).
2. DEVOPS / SRE / PLATFORM — DevOps, DevSecOps, Site Reliability, Platform/Infrastructure engineering, CI/CD, Kubernetes, Docker, Terraform.
3. CLOUD — cloud engineering, architecture, administration or consulting on AWS, Azure, GCP.
4. CYBER SECURITY (offensive and defensive) — security engineering/analysis/architecture, SOC, penetration testing, red/blue/purple team, ethical hacking, vulnerability management, threat hunting, incident response, DFIR, malware analysis, application/cloud security, IAM, SIEM/SOAR, security GRC.

If any job in the input falls OUTSIDE these four domains — civil or construction QA-QC, site or field inspection, manufacturing / factory / oil & gas quality, food or pharmaceutical or laboratory quality, HSE, ISO 9001 / QMS corporate quality, PHYSICAL security (guards, patrols, CCTV, fire safety), or unrelated roles such as pure developer, data, AI, PR, media or sales — DO NOT select it, even if nothing else is left. It slipped through the filter by mistake.

The employer's industry does NOT disqualify a job: a DevOps, cloud or cyber-security role at an oil, construction or manufacturing company is perfectly valid. Judge the ROLE, not the company.

Select up to 10 most important/attractive jobs from the given Jobs array.

Prioritize:
- Senior/lead roles over entry level
- Competitive salaries
- Reputable companies/entities (government or private)
- Automation-focused roles (SDET, test automation) over purely manual testing
- Try to represent different Saudi cities/regions when quality allows (not only Riyadh)

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
