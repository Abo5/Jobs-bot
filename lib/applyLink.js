// استخراج "رابط التقديم الحقيقي" من صفحة إعلان (خاصة ewdifh.com).
//
// المشكلة: صفحة الإعلان فيها روابط <a>اضغط هنا</a> كثيرة ومتشابهة تماماً —
// دعائية (تليجرام/واتساب/تطبيق الموقع)، وصور الإعلان (pbs.twimg)، ورابط
// التقديم الفعلي. ما فيه كلاس/ID مميّز للزر. العلامة المضمونة عبر كل الصفحات
// هي *النص اللي قبل الرابط*: التقديم دايماً بعد "طريقة التقديم … الرابط التالي".
//
// لذلك نرتّب الروابط بنقاط حسب النص السابق لها ونستبعد الدومينات الدعائية،
// ثم (اختيارياً) نحلّ المختصرات مثل lik.ad إلى وجهتها النهائية (jadarat.sa …).

import axios from 'axios';

const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'ar,en;q=0.8'
};

// دومينات دعائية/اجتماعية/صور — ليست رابط تقديم أبداً
const NOISE_HOSTS = [
  'ewdifh.com', 'wadhefa.com', 'sabbar.com',
  't.me', 'telegram.me', 'telegram.org',
  'wa.me', 'whatsapp.com', 'chat.whatsapp.com',
  'twitter.com', 'x.com', 'pbs.twimg.com',
  'facebook.com', 'fb.com', 'instagram.com',
  'youtube.com', 'youtu.be', 'snapchat.com', 'tiktok.com',
  'googleadservices.com', 'googlesyndication.com'
];

// مختصرات روابط نحلّها لوجهتها النهائية (الموقع يستخدم lik.ad كثيراً)
const SHORTENER_HOSTS = [
  'lik.ad', 'bit.ly', 'cutt.ly', 'goo.gl', 't.co',
  'tinyurl.com', 'rb.gy', 'is.gd', 'shorturl.at', 'lnkd.in'
];

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|svg|pdf)(\?|#|$)/i;

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
}

function isNoiseHost(host) {
  return NOISE_HOSTS.some(h => host === h || host.endsWith('.' + h));
}
function isShortener(host) {
  return SHORTENER_HOSTS.some(h => host === h || host.endsWith('.' + h));
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// نقاط النص اللي *قبل* الرابط: كل ما اقترب من عبارة التقديم، زادت الثقة
function scoreContext(before, innerText, href) {
  const host = hostOf(href);
  if (!href || !/^https?:/i.test(href)) return -1;
  if (isNoiseHost(host)) return -1;          // دعائي/اجتماعي
  if (IMAGE_EXT.test(href) && !isShortener(host)) return -1; // صورة/PDF إعلان

  let score = 0;
  const ctx = stripTags(before);
  const inner = stripTags(innerText);

  if (/الرابط\s*التالي/.test(ctx)) score += 100; // أقوى إشارة على الإطلاق
  if (/طريقة\s*التقديم/.test(ctx)) score += 60;
  if (/رابط\s*التقديم|للتقديم|التقديم\s*(من|عبر|عن)/.test(ctx)) score += 50;
  if (/التسجيل|للتسجيل|رابط\s*التسجيل/.test(ctx)) score += 30;
  if (/الموقع\s*(الرسمي|الإلكتروني)|رابط\s*الإعلان/.test(ctx)) score += 20;
  if (/^(اضغط\s*هنا|من\s*هنا|التقديم|قدّ?م\s*الآن|اضغط\s*للتقديم)$/.test(inner)) score += 15;

  // ترجيح بسيط لدومين حكومي/تعليمي رسمي
  if (/\.(gov|edu)\.sa$|\.gov\.sa$|jadarat\.sa$|masar\.sa$|qiwa\.sa$/.test(host)) score += 10;

  return score;
}

/**
 * يستخرج رابط التقديم الخام من HTML الصفحة (قبل حل المختصرات).
 * يرجّع { url, context } أو null إذا ما لقى مرشح موثوق.
 */
export function extractApplyLink(html) {
  if (!html) return null;
  const re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const candidates = [];
  let m;
  while ((m = re.exec(html))) {
    const href = m[1].replace(/&amp;/g, '&').trim();
    const innerText = m[2];
    const before = html.slice(Math.max(0, m.index - 160), m.index); // النص السابق
    const score = scoreContext(before, innerText, href);
    if (score > 0) candidates.push({ href, score, context: stripTags(before).slice(-70) });
  }
  if (!candidates.length) return null;

  // الأعلى نقاطاً؛ وعند التعادل نأخذ *الأخير* (رابط التقديم عادة قرب نهاية الإعلان)
  let best = candidates[0], bestIdx = 0;
  candidates.forEach((c, i) => { if (c.score >= best.score) { best = c; bestIdx = i; } });
  return { url: best.href, context: best.context };
}

/** يتبع تحويلات المختصر (lik.ad …) ويرجّع الوجهة النهائية. آمن ضد الأخطاء. */
export async function resolveRedirects(url, maxHops = 5) {
  let current = url;
  for (let i = 0; i < maxHops; i++) {
    const host = hostOf(current);
    if (i > 0 && !isShortener(host)) break; // نحل المختصرات فقط، مو كل رابط
    if (i === 0 && !isShortener(host)) break;
    try {
      const resp = await axios.get(current, {
        maxRedirects: 0, timeout: 15000, headers: UA,
        validateStatus: () => true
      });
      const loc = resp.headers?.location;
      if (resp.status >= 300 && resp.status < 400 && loc) {
        current = new URL(loc, current).toString();
        continue;
      }
      break; // وصلنا وجهة غير تحويل (حتى لو 403، الرابط نفسه صحيح)
    } catch {
      break;
    }
  }
  return current;
}

/**
 * الواجهة الرئيسية: HTML الصفحة -> رابط التقديم النهائي (محلول من المختصرات).
 * يرجّع string أو null. آمن تماماً، ما يرمي أخطاء.
 */
export async function getApplyUrl(html) {
  try {
    const found = extractApplyLink(html);
    if (!found) return null;
    return await resolveRedirects(found.url);
  } catch {
    return null;
  }
}
