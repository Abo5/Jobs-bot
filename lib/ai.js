// NVIDIA-hosted AI (OpenAI-compatible chat completions)
import axios from 'axios';

const NVIDIA_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || 'z-ai/glm-5.2';
const MAX_TOKENS = Number(process.env.NVIDIA_MAX_TOKENS || 4096);
// مهلة أقصر: ١٨٠ث كانت تعني انتظار ٣ دقائق قبل الفشل، وبثلاث محاولات ٩ دقائق
// للاستدعاء الواحد. ٩٠ث تكفي لردود هذا الحجم وتترك مجالاً لإعادة محاولة حقيقية.
const AI_TIMEOUT_MS = Number(process.env.NVIDIA_TIMEOUT_MS || 90000);
// لاحظنا تجريبياً: بالضبط 10 طلبات تنجح ثم 429 مستمر حتى بفاصل 2.5 ثانية —
// يعني الحد الفعلي أقل من ~24 طلب/دقيقة. رفعنا الفاصل لـ7 ثواني (~8.5 طلب/دقيقة) كهامش أمان.
const MIN_GAP_MS = Number(process.env.NVIDIA_MIN_GAP_MS || 7000);

// طابور عام يخلي طلبات NVIDIA تُرسل وحدة وحدة بفاصل زمني ثابت — بغض النظر
// عن MAX_AI_PARALLEL بالسكربت الرئيسي. لاحظنا إن إرسال ~40 طلب خلال دقيقتين
// (حتى بتوازي 3) يفجّر حد الطلبات بالدقيقة للمفتاح، ويفشل بالذات آخر طلب
// (تجميع أهم الوظائف) اللي يحدد وش يُنشر بتيليجرام.
let queue = Promise.resolve();
let lastCallAt = 0;

function throttle() {
  const run = queue.then(async () => {
    const wait = Math.max(0, lastCallAt + MIN_GAP_MS - Date.now());
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastCallAt = Date.now();
  });
  queue = run.catch(() => {}); // ما نكسر الطابور لو فشل طلب سابق
  return run;
}

export async function callAI({ system, user, expectJson = false, retries = 3 }) {
  if (!NVIDIA_API_KEY) throw new Error('NVIDIA_API_KEY missing in .env');
  await throttle();

  const systemPrompt =
    system +
    '\n\nSTRICT OUTPUT RULES:\n' +
    (expectJson
      ? '- Return ONLY valid JSON. No commentary, no markdown.'
      : '- Answer directly with no preface.');

  const payload = {
    model: NVIDIA_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: user }
    ],
    temperature: 0.4,
    top_p: 1,
    max_tokens: MAX_TOKENS,
    stream: false
  };

  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await axios.post(NVIDIA_API_URL, payload, {
        headers: {
          Authorization: `Bearer ${NVIDIA_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: AI_TIMEOUT_MS,
        validateStatus: s => s >= 200 && s < 500
      });

      if (resp.status >= 400) {
        const err = new Error(`HTTP ${resp.status}: ${JSON.stringify(resp.data).slice(0, 300)}`);
        err.status = resp.status;
        throw err;
      }

      const text = resp.data?.choices?.[0]?.message?.content;
      if (!text || !String(text).trim()) throw new Error('Empty NVIDIA AI content');

      if (expectJson && !/[{[][\s\S]*[}\]]/.test(text)) {
        throw new Error('Expected JSON but got plain text');
      }

      return text;
    } catch (e) {
      lastErr = e;
      const status = e.status || e.response?.status;
      // ECONNABORTED = مهلة axios نفسها. كانت ناقصة من القائمة، فكل مهلة تخرج من
      // أول محاولة بلا إعادة — ١٠٧ فشلاً في يوم واحد (2026-08-10)، ومنها استدعاء
      // "أهم الوظائف" اللي سقوطه يرمي الاختيار للمسار البديل.
      const transient =
        [429, 502, 503, 504].includes(status) ||
        ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNABORTED', 'ERR_BAD_RESPONSE'].includes(e.code);

      if (!transient || i === retries - 1) break;

      const wait = status === 429 ? 8000 * (i + 1) : 2 ** i * 1500;
      console.log(`⏳ NVIDIA AI retry ${wait}ms (status/code: ${status || e.code})`);
      await new Promise(r => setTimeout(r, wait));
    }
  }

  throw lastErr || new Error('NVIDIA AI retries exhausted');
}

export function safeJsonParse(text) {
  const cleaned = String(text)
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .replace(/,\s*}/g, '}')
    .replace(/,\s*]/g, ']')
    .trim();

  return JSON.parse(cleaned);
}
