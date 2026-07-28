// بحث الوظائف عبر Yahoo Search (HTTP عادي، بدون متصفح، ولا يُحظر بالكابتشا).
// بديل لـ Google الذي صار يحظر السكربت بالكابتشا بالكامل (كل الاستعلامات = 0).
//
// اختير Yahoo بعد فحص ميداني من هذا السيرفر:
//   Bing  -> كابتشا (0 نتائج)،  Yandex -> 302 لصفحة تحقق،  DuckDuckGo -> 202 حظر.
//   Yahoo -> 200 ويرجّع نتائج عضوية فعلية (bayt/linkedin/glassdoor/jooble ...).
//
// روابط ياهو ملفوفة بريدايركت: .../RU=<urlencoded>/RK=... — نفكّها ونفلترها.
import axios from 'axios';

const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
  'Accept': 'text/html,application/xhtml+xml'
};

const MAX_PAGES = Number(process.env.YAHOO_MAX_PAGES || 2); // 2×10 نتائج/استعلام

// نفس منطق فلترة روابط الوظائف المستخدم مع جوجل (مطابق لـ isLikelyJobLink بالسكربت)
function isLikelyJobLink(h) {
  const s = h.toLowerCase();
  if (s.includes('yahoo.com') || s.includes('bing.com') || s.includes('google.com') ||
      s.includes('/search?') || s.includes('duckduckgo') || s.includes('uservoice')) return false;
  return (
    s.includes('/job') || s.includes('/jobs') || s.includes('career') || s.includes('careers') ||
    s.includes('linkedin.com/jobs') || s.includes('indeed.') || s.includes('bayt.com') ||
    s.includes('naukrigulf.com') || s.includes('glassdoor.') || s.includes('greenhouse.io') ||
    s.includes('lever.co') || s.includes('jooble') || s.includes('wadhefa') || s.includes('ewdifh')
  );
}

function extractYahooLinks(html) {
  const out = new Set();
  // 1) الروابط الملفوفة: /RU=<enc>/RK=
  const reRU = /\/RU=([^/]+)\/RK=/g;
  let m;
  while ((m = reRU.exec(html))) {
    try {
      const u = decodeURIComponent(m[1]);
      if (/^https?:\/\//i.test(u)) out.add(u);
    } catch {}
  }
  // 2) أي روابط مباشرة (بعض النتائج غير ملفوفة)
  const reHref = /href="(https?:\/\/[^"]+)"/g;
  while ((m = reHref.exec(html))) out.add(m[1].replace(/&amp;/g, '&'));
  return [...out];
}

async function fetchPage(query, b) {
  const url = `https://search.yahoo.com/search?p=${encodeURIComponent(query)}&b=${b}&pz=10&ei=UTF-8`;
  const { data } = await axios.get(url, {
    timeout: 20000, headers: UA, maxRedirects: 3,
    validateStatus: s => s >= 200 && s < 400
  });
  return typeof data === 'string' ? extractYahooLinks(data) : [];
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

// ترجع مصفوفة روابط وظائف مرشّحة (تُدمج ضمن browserLinks -> استخراج AI)
export async function fetchYahooLinks(queries) {
  const acc = new Set();

  for (const q of queries) {
    let found = 0;
    for (let p = 1; p <= MAX_PAGES; p++) {
      try {
        const links = await fetchPage(q, (p - 1) * 10 + 1);
        links.filter(isLikelyJobLink).forEach(l => { acc.add(l); found++; });
      } catch (e) {
        const code = e.response?.status || e.code || e.message;
        console.warn(`   ⚠️ [yahoo] "${q}" page ${p} skipped (${code})`);
        break;
      }
      await sleep(rand(700, 1600)); // تهدئة مهذّبة
    }
    console.log(`>>> [yahoo] ${q} (count = ${found})`);
  }

  console.log(`>>> [yahoo] إجمالي الروابط المرشّحة = ${acc.size}`);
  return [...acc];
}
