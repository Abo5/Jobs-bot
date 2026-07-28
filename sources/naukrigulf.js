// Naukrigulf.com — سحب مباشر (تم التحقق أنه يعمل بدون حظر)
const STOPWORDS = /\b(jobs?|in|at|for|near|saudi|arabia|ksa|riyadh|jeddah|dammam|khobar)\b/gi;

export async function scrapeNaukrigulf(pg, keyword) {
  const core = keyword.replace(STOPWORDS, ' ').replace(/\s+/g, ' ').trim() || keyword;

  const slug = core
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');

  const url = `https://www.naukrigulf.com/${slug}-jobs-in-saudi-arabia`;

  try {
    await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const links = await pg.$$eval('a[href]', as => [...new Set(as.map(a => a.href))]);
    return links.filter(h => /-jid-\d/.test(h));
  } catch (err) {
    console.warn(`⚠️ Naukrigulf failed for "${keyword}": ${err.message}`);
    return [];
  }
}
