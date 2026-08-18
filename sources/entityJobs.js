// مراقبة الجهات شبه الحكومية والهيئات على لنكدإن — كل إعلاناتها لا الكلمات المفتاحية.
//
// ليش مصدر منفصل: مسار الكلمات المفتاحية يجيب ما يطابق مسمّى تقنياً، فيفوّت ما
// تنشره هذي الجهات دورياً من برامج خريجين وتدريب وابتعاث ("Graduate Development
// Program" · "برنامج التميز" · "Tamheer") لأن مسمّياتها ما فيها كلمة تقنية.
// هنا نراقب الجهة نفسها: نجيب *كل* وظائفها ثم نصنّفها.
//
// ليش f_C لا البحث بالاسم: البحث النصي يطابق محتوى الإعلان لا الشركة، فقِسناه
// وكان ضجيجاً — "SDAIA" أرجعت KAUST وAmadeus، و"Qiddiya" أرجعت شركات لا علاقة
// لها. أما f_C=<company_id> فأرجع وظائف الجهة وحدها بدقة ١٠٠٪.
//
// المعرّفات محفوظة في entities.json ويحلّها resolve-entities.mjs مرة واحدة.
import axios from 'axios';
import fs from 'fs';
import { shouldSkipLinkedin, reportLinkedin429, isTripped } from '../lib/liGate.js';

const BASE = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
  'Accept': 'text/html,application/xhtml+xml',
  'X-Requested-With': 'XMLHttpRequest'
};

const FILE = process.env.ENTITIES_FILE || 'entities.json';
const PER_PAGE = 10;
const MAX_PAGES = Number(process.env.ENTITY_MAX_PAGES || 3);
// تدوير الجهات: ٣٤ جهة × ٣ صفحات = ١٠٢ طلب لو مررناها كلها كل تشغيلة — يفجّر حد
// لنكدإن. نأخذ شريحة تدور بساعة الرياض (تشغيلة كل ساعتين)، فتُغطّى كلها كل ١٢ ساعة:
//   8 تشغيلات × 9 جهات = 72 طلب/يوم  (كل ٣ ساعات — السابق)
//  12 تشغيلة × 6 جهات = 72 طلب/يوم  (كل ساعتين — نفس الحِمل الآمن تماماً)
const SLICE = Number(process.env.ENTITY_SLICE ?? 6);
const BACKOFF_MS = Number(process.env.LI_BACKOFF_MS || 25000);

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

function parseCards(html, entity) {
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
    jobs.push({
      source: 'linkedin-entity',
      entity: entity.name_ar || entity.name_en,
      entity_type: entity.type || '',
      job_id: url.match(/(\d{8,})(?:\/)?$/)?.[1] ?? '',
      job_url: url,
      job_title: firstMatch(block, /base-search-card__title[^>]*>\s*([^<]+)/),
      company: firstMatch(block, /base-search-card__subtitle[^>]*>\s*(?:<a[^>]*>\s*)?([^<]+)/) || entity.name_en,
      location: location || 'Saudi Arabia',
      description: '',
      salary: 'غير محدد',
      posted_date: firstMatch(block, /datetime="([^"]+)"/) || 'unknown',
      is_remote: /remote|عن\s*بعد/i.test(location || '')
    });
  }
  return jobs;
}

async function fetchCompanyPage(companyId, start, retry = true) {
  const { data, status } = await axios.get(BASE, {
    params: { f_C: companyId, location: 'Saudi Arabia', start },
    timeout: 25000, headers: HEADERS,
    validateStatus: s => (s >= 200 && s < 400) || s === 429
  });
  if (status === 429) {
    if (!retry) {
      // 429 صعبة — تُسجَّل في القاطع المشترك مع مصدر الكلمات
      reportLinkedin429();
      const e = new Error('429'); e.rateLimited = true; throw e;
    }
    await sleep(BACKOFF_MS);
    return fetchCompanyPage(companyId, start, false);
  }
  return typeof data === 'string' ? data : '';
}

/** الجهات المستحقة لهذه التشغيلة — تدوير بساعة الرياض، بلا حالة محفوظة */
export function entitiesForThisRun() {
  let all;
  try {
    all = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    console.warn(`   ⚠️ [entities] تعذّر قراءة ${FILE}: ${e.message}`);
    return [];
  }
  const active = all.filter(e => e.company_id);
  if (!SLICE || SLICE >= active.length) return active;

  const riyadhHour = Number(new Date(Date.now() + 3 * 3600e3).toISOString().slice(11, 13));
  const slot = Math.floor(riyadhHour / 2);                     // 0..11 (تشغيلة كل ساعتين)
  const windows = Math.ceil(active.length / SLICE);
  const offset = (slot % windows) * SLICE;
  const out = [];
  for (let i = 0; i < SLICE; i++) out.push(active[(offset + i) % active.length]);
  return [...new Set(out)];
}

export async function fetchEntityJobs() {
  // نفس قاطع لنكدإن: لو تشغيلة سابقة قطعت لنكدإن، نتخطّى الجهات هذه التشغيلة
  // — الجهات كلها على واجهة الضيف نفسها، فالمطرقة عليها تطيل الحظر بلا فايدة.
  if (shouldSkipLinkedin()) return [];

  const entities = entitiesForThisRun();
  if (!entities.length) {
    console.log('   ℹ️ [entities] لا جهات محلولة — شغّل resolve-entities.mjs');
    return [];
  }

  const all = [];
  const seenUrls = new Set();
  let withJobs = 0;

  console.log(`   🏛️ [entities] نراقب ${entities.length} جهة هذه التشغيلة: ${entities.map(e => e.name_ar || e.name_en).join(' · ')}`);

  for (const ent of entities) {
    let added = 0;
    for (let p = 0; p < MAX_PAGES; p++) {
      let html;
      try {
        html = await fetchCompanyPage(ent.company_id, p * PER_PAGE);
      } catch (e) {
        console.warn(`   ⚠️ [entities] ${ent.name_en} صفحة ${p + 1} تخطّت (${e.response?.status || e.code || e.message})`);
        break;
      }
      const rows = parseCards(html, ent);
      if (!rows.length) break;
      for (const j of rows) {
        if (!j.job_url || seenUrls.has(j.job_url) || !j.job_title) continue;
        seenUrls.add(j.job_url);
        all.push(j);
        added++;
      }
      await sleep(1100 + Math.floor(Math.random() * 700));
    }
    if (added) { withJobs++; console.log(`   ✓ [entities] ${ent.name_ar || ent.name_en} -> ${added}`); }
    if (isTripped()) break;   // القاطع فُعّل — نتوقف عن بقية الجهات فوراً
  }

  console.log(`   ✓ [entities] جمعنا ${all.length} وظيفة من ${withJobs}/${entities.length} جهة\n`);
  return all;
}
