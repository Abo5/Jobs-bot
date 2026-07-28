# Jobs-bot

بوت يجمع الوظائف السعودية من عدة مصادر، يحلّلها بالذكاء الاصطناعي، وينشر الأهم في قناة تيليجرام.

يعمل تلقائياً كل ٦ ساعات عبر `cron`.

## المجالات المستهدفة

- **حكومي** — أي مجال
- **قطاع خاص** — تقنية، ضمان وضبط الجودة (QA/QC)، ذكاء اصطناعي، أمن سيبراني، علاقات عامة، إعلام، إذاعة وتلفزيون

## المصادر

### تعمل حالياً ✅

| المصدر | الطريقة | ملاحظات |
|---|---|---|
| **LinkedIn** | واجهة الضيف `jobs-guest/jobs/api/seeMoreJobPostings` | أقوى مصدر — بدون تسجيل دخول |
| **NaukriGulf** | واجهة تطبيق الجوال `ngma.mobi/spapi/jobapi/search` | بحث موجّه بالخادم عبر `Keywords` |
| **وظائف العرب** | خلاصات RSS من `jobs-arab.com/sa` | حد معدل صارم — تهدئة ٦ ثوانٍ |
| wadhefa.com / ewdifh.com / sabbar.com | كشط HTML + استخراج بالذكاء الاصطناعي | |
| Yahoo Search | بحث HTTP | ضعيف — بديل لجوجل المحظور |

### محجوبة على مستوى IP الخادم 🔴

`bayt.com` · `saudi.tanqeeb.com` · `mihnati.com` · `sa.indeed.com` · `jadarat.sa` · `gulftalent.com` · `google.com`

كلها ترجع **403 (Cloudflare)** — حتى عبر متصفح حقيقي (Puppeteer). فتحها يحتاج بروكسي/VPN.

### جاهزة بالكود لكن تحتاج مفتاح مجاني

Adzuna · Jooble · Findwork · Careerjet · JSearch — فعّلها بإضافة مفتاحها في `.env`.

## التشغيل

```bash
npm install
cp .env.example .env      # ثم عبّي NVIDIA_API_KEY و TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID
npm start
```

تشغيل مجدول (يمنع التداخل عبر `flock`):

```bash
0 */6 * * * /root/jobs-scraper/run.sh >> /var/log/jobs-scraper.log 2>&1
```

## البنية

```
jobs-scraper-fixed.js     التدفق الرئيسي: جمع ← فلترة ← تحليل AI ← نشر
keywords.json             المسميات الوظيفية المستهدفة
sources/
  linkedin.js             واجهة ضيف LinkedIn
  naukrigulfApi.js        واجهة تطبيق NaukriGulf
  jobsArab.js             خلاصات RSS لوظائف العرب
  saudiSites.js           wadhefa + ewdifh + sabbar
  yahooSearch.js          بحث ياهو
  apiSources.js           واجهات عالمية + واجهات تحتاج مفاتيح
lib/
  sectors.js              قاعدة القطاعات (حكومي / القطاعات المستهدفة)
  jobFilter.js            النافذة الزمنية + إزالة التكرار
  saudi.js                التحقق من الموقع السعودي
  ai.js                   استدعاء NVIDIA
  telegram.js             النشر في القناة
  seenStore.js            ذاكرة الوظائف المنشورة سابقاً
```

## ملاحظات

- `lib/sectors.js` — مطابقة القطاع الخاص تتم على **المسمّى الوظيفي** لا على وصف الوظيفة، لأن مطابقة الوصف الحر كانت تمرّر وظائف خارج النطاق (أي مهمة عابرة تُذكر فيه تقلب التصنيف). أي نمط جديد لازم يكون صيغة مسمّى وظيفي، مو جذر عام.
- الكلمات العربية لا تعمل كـ `Keywords` في واجهة NaukriGulf (ترجّع كل الوظائف بلا فلترة) — تُمرَّر الكلمات اللاتينية فقط.
- `.env` مستثنى من المستودع؛ لا ترفع المفاتيح.
