import axios from 'axios';
import fs from 'fs';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const POSTED_FILE = 'posted-jobs.json';

function loadPosted() {
  try {
    return new Set(JSON.parse(fs.readFileSync(POSTED_FILE, 'utf8')));
  } catch {
    return new Set();
  }
}

function savePosted(set) {
  fs.writeFileSync(POSTED_FILE, JSON.stringify([...set].slice(-3000)), 'utf8');
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatJobMessage(job) {
  const lines = [
    `💼 <b>${esc(job.important_title)}</b>`,
    job.important_company ? `🏢 ${esc(job.important_company)}` : null,
    job.important_location ? `📍 ${esc(job.important_location)}` : null,
    job.important_job_type ? `🕒 ${esc(job.important_job_type)}` : null,
    job.important_salary && job.important_salary !== 'غير محدد' ? `💰 ${esc(job.important_salary)}` : null,
    '',
    job.important_description_ar ? esc(job.important_description_ar) : null,
    job.why_important ? `\n⭐ ${esc(job.why_important)}` : null,
    '',
    job.important_url ? `🔗 ${job.important_url}` : null
  ];
  return lines.filter(l => l !== null).join('\n');
}

export async function sendJobsToTelegram(importantJobs) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('⚠️ TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID missing in .env — skipping Telegram send');
    return { sent: 0, skipped: 0, alreadyPosted: 0 };
  }

  const posted = loadPosted();
  let sent = 0;
  let alreadyPosted = 0;
  let failed = 0;

  for (const job of importantJobs) {
    const key = job.important_url || `${job.important_title}|${job.important_company}`;
    if (posted.has(key)) {
      alreadyPosted++;
      continue;
    }

    try {
      await axios.post(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        {
          chat_id: CHAT_ID,
          text: formatJobMessage(job),
          parse_mode: 'HTML',
          disable_web_page_preview: false
        },
        { timeout: 15000 }
      );
      posted.add(key);
      sent++;
      await new Promise(r => setTimeout(r, 1200)); // stay under Telegram flood limits
    } catch (e) {
      failed++;
      console.warn(
        `⚠️ Telegram send failed for "${job.important_title}": ${e.response?.data?.description || e.message}`
      );
    }
  }

  savePosted(posted);
  return { sent, skipped: failed, alreadyPosted };
}
