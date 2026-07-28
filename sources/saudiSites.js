// مواقع وظائف سعودية إضافية — تشتغل بطلب HTTP عادي (بدون متصفح/بدون حظر Cloudflare)
// ملاحظة: Bayt.com و Tanqeeb.com و Taqat.sa محظورين على مستوى IP السيرفر (Cloudflare) —
// جُرّبوا وفشلوا (403/timeout)، ما ضُمّنوا هنا. Bayt يبقى يوصلنا فقط عبر نتائج جوجل.
import axios from 'axios';

const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'ar,en;q=0.8'
};

function extractHrefs(html, pattern) {
  const re = new RegExp(`href="(${pattern})"`, 'g');
  const out = new Set();
  let m;
  while ((m = re.exec(html))) out.add(m[1].replace(/&amp;/g, '&'));
  return [...out];
}

// wadhefa.com — بحث فعلي بالكلمة المفتاحية، روابط /details/job/<id>/search/
// ملاحظة: الموقع صغير وعنده rate-limit صارم بالدقيقة — نحد النتائج المُرجعة
// عشان ما نغرق مرحلة استخراج AI بروابط كثيرة تتحظر (429) من نفس الدومين.
export async function fetchWadhefa(keyword, limit = 8) {
  const url = `https://www.wadhefa.com/jobfind.php?action=search&bx_jtitle=${encodeURIComponent(keyword)}&rdjt=2&posted=30&o=1`;
  try {
    const { data } = await axios.get(url, { timeout: 20000, headers: UA });
    return extractHrefs(data, 'https://www\\.wadhefa\\.com/details/job/\\d+/search/').slice(0, limit);
  } catch (err) {
    console.warn(`⚠️ wadhefa.com failed for "${keyword}": ${err.message}`);
    return [];
  }
}

// ewdifh.com — ما يدعم بحث بالكلمة، نتصفح آخر الوظائف العامة ونفلتر تقنية بعدين
export async function fetchEwdifh(pages = 1, limit = 12) {
  const acc = new Set();
  for (let p = 1; p <= pages; p++) {
    const url = p === 1
      ? 'https://www.ewdifh.com/category/all-jobs'
      : `https://www.ewdifh.com/category/all-jobs?page=${p}`;
    try {
      const { data } = await axios.get(url, { timeout: 20000, headers: UA });
      extractHrefs(data, 'https://www\\.ewdifh\\.com/jobs/\\d+').forEach(l => acc.add(l));
    } catch (err) {
      console.warn(`⚠️ ewdifh.com page ${p} failed: ${err.message}`);
    }
  }
  return [...acc].slice(0, limit);
}

// sabbar.com — بحث الكلمة المفتاحية غير موثوق (SPA)، نتصفح ونفلتر تقنية بعدين
export async function fetchSabbar(pages = 1, limit = 12) {
  const acc = new Set();
  for (let p = 1; p <= pages; p++) {
    const url = p === 1 ? 'https://sabbar.com/ar/jobs' : `https://sabbar.com/ar/jobs?page=${p}`;
    try {
      const { data } = await axios.get(url, { timeout: 20000, headers: UA });
      extractHrefs(data, '/ar/jobs/r-[^"]+').forEach(l => acc.add(`https://sabbar.com${l}`));
    } catch (err) {
      console.warn(`⚠️ sabbar.com page ${p} failed: ${err.message}`);
    }
  }
  return [...acc].slice(0, limit);
}
