// "דופק אמיתי" — בודק שהכול עובד, ושולח התראה למנהל בלבד (ערוץ ntfy סודי, ADMIN_TOPIC) אם משהו נפל.
// רץ בסוף כל סבב עדכון ובתחילת כל סבב תמלול, כך ששני התהליכים משגיחים זה על זה.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const P = (...a) => path.join(ROOT, ...a);
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(P(f), 'utf8')); } catch { return d; } };
const ADMIN = process.env.ADMIN_TOPIC;
const WHO = process.argv.includes('--from=transcribe') ? 'transcribe' : 'update';
const now = Date.now();
const mins = (iso) => iso ? Math.round((now - new Date(iso)) / 60000) : Infinity;
const ilHour = +new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hour12: false }).format(new Date()) % 24;
const daytime = ilHour >= 9 && ilHour <= 23;
const fmt = (m) => m === Infinity ? 'אף פעם' : m < 90 ? `${m} דקות` : `${Math.round(m / 60)} שעות`;

async function send(title, message, priority = 4) {
  if (!ADMIN) { console.log('[no ADMIN_TOPIC]', title, message); return; }
  try {
    await fetch('https://ntfy.sh/', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: ADMIN, title, message, priority, tags: [priority >= 4 ? 'rotating_light' : 'white_check_mark'],
        click: 'https://github.com/oridor005-ux/dofek/actions' }) });
  } catch (e) { console.log('alert send failed', e.message); }
}

if (process.argv.includes('--test')) {
  await send('🔧 בדיקת התראות מנהל', 'אם זה הגיע — תקבל כאן הודעה אם משהו בדופק אמיתי נופל.', 3);
  process.exit(0);
}

const state = readJSON('data/state.json', {});
const h = state.health || {};
const insights = readJSON('data/insights.json', { items: [] }).items;
const summaries = readJSON('data/summaries.json', {});
const videos = readJSON('data/videos.json', {});
const config = readJSON('config.json', {});

const problems = {}; // key -> text
// 1. המנוע (נבדק מתהליך התמלול — אם המנוע עצמו לא רץ הוא לא יכול לדווח על עצמו)
if (WHO === 'transcribe' && mins(state.lastRun) > 45)
  problems.engine = `איסוף הכותרות והפושים לא רץ כבר ${fmt(mins(state.lastRun))}.`;
// 2. מקורות
const src = h.sources;
if (src && src.direct && src.directFail / src.direct > 0.5)
  problems.sources = `${src.directFail} מתוך ${src.direct} אתרי החדשות לא עונים.`;
if (src && src.google && src.googleFail / src.google > 0.8 && mins(h.googleOkAt) > 180)
  problems.google = `חיפושי Google News נכשלים כבר ${fmt(mins(h.googleOkAt))} (כנראה חסימה זמנית).`;
if (daytime && mins(h.lastNewItemAt) > 240 && mins(state.lastRun) < 45)
  problems.noNews = `לא נכנסה אף ידיעה חדשה כבר ${fmt(mins(h.lastNewItemAt))}.`;
// 3. פושים
if (h.lastPushError && mins(h.lastPushError.at) < 60)
  problems.push = `שליחת פושים נכשלת: ${h.lastPushError.msg}`;
if (WHO === 'update' && (state.ntfyTokenSet === false || state.ownerKeySet === false))
  problems.secrets = 'חסר מפתח סודי ב-GitHub (NTFY_TOKEN או OWNER_KEY).';
// 4. סבבי Claude (סיכומים ובדיקות)
const lastClaude = [...insights.map(i => i.published), ...Object.values(summaries).map(s => s.updated)].filter(Boolean).sort().pop();
if (daytime && mins(lastClaude) > 300)
  problems.claude = `סבב הסיכומים והבדיקות של Claude לא הוסיף כלום כבר ${fmt(mins(lastClaude))}. אולי נגמרה מכסת השימוש, או שהמשימה המתוזמנת נכשלה.`;
// 5. טיקטוק
const vh = videos.health;
if ((config.tiktokChannels || []).length && vh) {
  if (vh.channelsOk === 0 && vh.channelsFail > 0) problems.tiktok = `אף ערוץ טיקטוק לא נטען (${vh.channelsFail} נכשלו). ייתכן שטיקטוק חוסם.`;
  if (mins(vh.at) > 90 && WHO === 'update') problems.tiktokStale = `מעקב הטיקטוק לא רץ כבר ${fmt(mins(vh.at))}.`;
}

// שליחה: התראה חדשה מיד, תזכורת כל 6 שעות, והודעה כשהבעיה נפתרה
const hs = readJSON('data/health.json', { open: {} });
let changed = false;
for (const [k, text] of Object.entries(problems)) {
  const o = hs.open[k];
  if (!o || mins(o.lastSent) > 360) {
    await send(o ? '⚠️ עדיין לא תקין' : '🚨 משהו נפל בדופק אמיתי', text);
    hs.open[k] = { text, since: o?.since || new Date().toISOString(), lastSent: new Date().toISOString() };
    changed = true;
  }
}
for (const k of Object.keys(hs.open)) {
  // בעיות שרק תהליך אחד יכול לזהות — לא לסגור אותן מהתהליך השני
  const onlyFrom = { engine: 'transcribe', secrets: 'update', tiktokStale: 'update' }[k];
  if (onlyFrom && onlyFrom !== WHO) continue;
  if (!problems[k]) { await send('✅ חזר לעבוד', `נפתר: ${hs.open[k].text}`, 3); delete hs.open[k]; changed = true; }
}
// 6. ערוצי טיקטוק חדשים: הודעה למנהל כשערוץ שנוסף ל-config.json מתחיל להופיע (פעם אחת לכל ערוץ)
const live = new Set((videos.items || []).map(v => v.channel));
const configured = (config.tiktokChannels || []).map(c => (c.handle || c).replace(/^@/, ''));
if (!Array.isArray(hs.channelsSeen)) { hs.channelsSeen = configured.filter(c => live.has(c)); changed = true; }
else {
  const fresh = configured.filter(c => live.has(c) && !hs.channelsSeen.includes(c));
  if (fresh.length) {
    await send('📺 ערוצים חדשים בדופק אמיתי', `מעכשיו נבדקים גם: ${fresh.join(', ')} (${configured.length} ערוצי טיקטוק במעקב).`, 3);
    hs.channelsSeen.push(...fresh);
    changed = true;
  }
}
if (changed) fs.writeFileSync(P('data/health.json'), JSON.stringify(hs, null, 1) + '\n');
console.log('health:', Object.keys(problems).length ? problems : 'ok');
