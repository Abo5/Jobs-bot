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

const BASE = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
  'Accept': 'text/html,application/xhtml+xml',
  'X-Requested-With': 'XMLHttpRequest'
};

const LOCATION = process.env.LI_LOCATION || 'Saudi Arabia';
const PER_PAGE = 10;                                              // ثابت من الواجهة
const MAX_PAGES = Number(process.env.LI_MAX_PAGES || 2);          // 2×10 = ~20/كلمة
const PER_KEYWORD = Number(process.env.LI_PER_KEYWORD || 12);     // سقف لكل كلمة

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
    jobs.push({
      source: 'linkedin',
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

async function fetchPage(keyword, start) {
  const { data } = await axios.get(BASE, {
    params: { keywords: keyword, location: LOCATION, start },
    timeout: 25000,
    headers: HEADERS,
    validateStatus: s => s >= 200 && s < 400
  });
  return typeof data === 'string' ? parseCards(data) : [];
}

// تجمع وظائف لنكدإن لكل كلمة مفتاحية — نفس شكل مصادر apiSources (تمرّر مباشرة لـ apiJobs)
export async function fetchLinkedinJobs(keywords) {
  const out = [];
  const seen = new Set();

  for (const kw of keywords) {
    let added = 0;
    for (let p = 0; p < MAX_PAGES && added < PER_KEYWORD; p++) {
      let rows;
      try {
        rows = await fetchPage(kw, p * PER_PAGE);
      } catch (e) {
        const code = e.response?.status || e.code || e.message;
        console.warn(`   ⚠️ [linkedin] "${kw}" page ${p + 1} skipped (${code})`);
        break;
      }
      if (!rows.length) break;
      for (const j of rows) {
        if (!j.job_url || seen.has(j.job_url) || !j.job_title) continue;
        seen.add(j.job_url);
        out.push(j);
        if (++added >= PER_KEYWORD) break;
      }
      await new Promise(r => setTimeout(r, 400 + Math.floor(Math.random() * 400))); // تهدئة
    }
    if (added) console.log(`   ✓ [linkedin] "${kw}" -> ${added}`);
  }

  console.log(`   ✓ [linkedin] جمعنا ${out.length} وظيفة سعودية من واجهة الضيف`);
  return out;
}
