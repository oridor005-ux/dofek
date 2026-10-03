// "דופק" — אוסף כותרות, מסווג, מסמן חשובות ושולח פושים דרך ntfy.
// רץ ב-GitHub Actions כל חצי שעה. ללא תלויות חיצוניות (Node 20+).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  TOPICS, directFeeds, googleQueries, googleNewsUrl,
  topicKeywords, importantKeywords, IMPORTANT_THRESHOLD, topicBonus, blockedSources, blockedWords,
} from './sources.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const P = (...a) => path.join(ROOT, ...a);
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(P(f), 'utf8')); } catch { return d; } };
const writeJSON = (f, v) => fs.writeFileSync(P(f), JSON.stringify(v, null, 1) + '\n');

const config = readJSON('config.json', {});
const NTFY = config.ntfyServer || 'https://ntfy.sh';
const DRY = !!process.env.DRY_RUN;            // לא שולח פושים באמת
const FIXTURES = process.env.FIXTURES;        // תיקייה עם קבצי XML לבדיקה מקומית
const APP_URL = process.env.APP_URL || '';
const log = (...a) => console.log(...a);
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36';

// ---------- רשת ----------
async function get(url, { timeout = 20000, accept = '*/*' } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, 'Accept': accept } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

// ---------- RSS ----------
const unescape = (s = '') => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');
const decode = (s = '') => unescape(unescape(s).replace(/<[^>]+>/g, ' ')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? m[1] : ''; };
const isImg = (u) => /\.(jpe?g|png|webp)(\?|$)/i.test(u) || /image|img|photo|media|picture/i.test(u);

function findImage(it) {
  const cands = [];
  for (const m of it.matchAll(/<media:(?:content|thumbnail)\b[^>]*>/gi)) {
    const u = (m[0].match(/url=["']([^"']+)["']/i) || [])[1];
    if (u && !/medium=["'](video|audio)/i.test(m[0])) cands.push(unescape(u));
  }
  for (const m of it.matchAll(/<enclosure\b[^>]*>/gi)) {
    const u = (m[0].match(/url=["']([^"']+)["']/i) || [])[1];
    if (u && (/type=["']image/i.test(m[0]) || isImg(u))) cands.push(unescape(u));
  }
  const html = unescape(tag(it, 'description') + tag(it, 'content:encoded'));
  const im = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (im) cands.push(im[1]);
  return cands.find(u => /^https?:\/\//.test(u) && !/1x1|pixel|spacer|feedburner|gravatar/i.test(u)) || '';
}

export function parseRss(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const it = m[0];
    items.push({
      title: decode(tag(it, 'title')),
      link: decode(tag(it, 'link')),
      pubDate: decode(tag(it, 'pubDate')),
      source: decode(tag(it, 'source')),
      description: decode(tag(it, 'description')),
      image: findImage(it),
    });
  }
  return items;
}

async function getXml(url, fixtureName) {
  if (FIXTURES) {
    const f = path.join(FIXTURES, fixtureName);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  }
  return get(url, { accept: 'application/rss+xml, application/xml, text/xml, */*' });
}

// תמונה מהכתבה עצמה (og:image) — רק לידיעות שעומדות להישלח בפוש
async function ogImage(url) {
  if (FIXTURES || !url || /news\.google\./.test(url)) return '';
  try {
    const html = (await get(url, { timeout: 8000, accept: 'text/html' })).slice(0, 200000);
    const m = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/i);
    const u = m && (m[0].match(/content=["']([^"']+)["']/i) || [])[1];
    return u && /^https?:\/\//.test(u) ? unescape(u) : '';
  } catch { return ''; }
}

// ---------- עזרי טקסט ----------
const norm = (s) => s.replace(/["'״׳`,.:;!?()\[\]\-–—|]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const words = (s) => new Set(norm(s).split(' ').filter(w => w.length > 1));
const jaccard = (a, b) => { let i = 0; for (const w of a) if (b.has(w)) i++; return i / (a.size + b.size - i || 1); };
const idOf = (title) => crypto.createHash('sha1').update(norm(title)).digest('hex').slice(0, 12);
const clip = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s);

const lc = (t) => ' ' + t.toLowerCase() + ' ';
const ORDER = ['media', 'factcheck', 'demo', 'laws', 'defense', 'israelAbroad', 'knesset', 'research', 'deals', 'econ', 'world'];
function classify(text) {
  const t = lc(text);
  for (const topic of ORDER) if ((topicKeywords[topic] || []).some(k => t.includes(k.toLowerCase()))) return topic;
  return null;
}
function score(text) { const t = lc(text); return importantKeywords.reduce((s, { k, w }) => s + (t.includes(k.toLowerCase()) ? w : 0), 0); }

// ---------- איסוף ----------
async function collect() {
  const jobs = [
    ...directFeeds.map((f, i) => ({ ...f, fixture: `direct-${i}.xml` })),
    ...googleQueries.map((g, i) => ({ name: null, url: googleNewsUrl(g.q, g.lang), topic: g.topic, q: g.q, fixture: `google-${i}.xml`, google: true })),
  ];
  const results = await Promise.allSettled(jobs.map(async (j) => ({ j, items: parseRss(await getXml(j.url, j.fixture)) })));
  const out = []; let ok = 0, fail = 0;
  for (const r of results) {
    if (r.status !== 'fulfilled') { fail++; log('  ✗', r.reason?.message); continue; }
    ok++;
    const { j, items } = r.value;
    for (const it of items.slice(0, 15)) {
      let title = it.title, source = j.name || it.source;
      if (j.google) { // "כותרת - שם האתר"
        const k = title.lastIndexOf(' - ');
        if (k > 10) { source = source || title.slice(k + 3); title = title.slice(0, k); }
      }
      if (!title || !it.link || title.replace(/[-–\s]/g, '').length < 18) continue;
      if (source && title.trim().endsWith(source) && title.length < 40) continue; // עמודי כותבים וכו'
      if (blockedSources.some(b => (source || '').toLowerCase().includes(b) || it.link.toLowerCase().includes(b.replace(/\s/g, '')))) continue;
      if (blockedWords.some(b => lc(title).includes(b.toLowerCase()))) continue;
      if (/[\u0600-\u06FF]/.test(source + title)) continue; // אתרים בערבית (תרגום מכונה לא אמין)
      const text = title + ' ' + (j.google ? '' : it.description);
      let topic;
      if (j.google) {
        // מחיפוש: רק אם הכותרת באמת קשורה (מתאימה למילות מפתח או למילים מהחיפוש)
        const generic = ['contract', 'support', 'results', 'government', 'parliament', 'passed', 'new', 'law', 'weapons', 'public', 'opinion', 'election', 'americans', 'europe', 'poll', 'deal', 'military', 'sanctions', 'state',
          'ישראל', 'ישראלי', 'ישראלים', 'נתונים', 'מספר', 'חדש', 'חדשים', 'חדשה', 'סקר', 'מחקר', 'עזבו', 'אמר', 'טענה', 'דוח', 'מיליון', 'דולר'];
        const qWords = j.q.replace(/"|site:\S+|\bOR\b/g, ' ').split(/\s+/).filter(w => w.length > 2 && !generic.includes(w.toLowerCase()));
        const isSite = /site:/.test(j.q);
        const hits = qWords.filter(w => lc(title).includes(w.toLowerCase())).length;
        topic = classify(text) || ((isSite || hits >= Math.min(2, qWords.length)) ? j.topic : null);
      } else {
        topic = j.topic && j.topic !== 'econ' ? j.topic : (classify(text) || j.topic || j.fallback);
      }
      if (!topic) continue; // לא רלוונטי לנושאים שלנו
      const d = new Date(it.pubDate);
      const desc = j.google ? '' : it.description;
      out.push({
        id: idOf(title), kind: 'headline', title, source: source || '', url: it.link, topic,
        published: isNaN(d) ? new Date().toISOString() : d.toISOString(),
        summary: desc && !norm(desc).startsWith(norm(title).slice(0, 30)) ? clip(desc, 300) : '',
        image: it.image || '',
        score: score(text) + (topicBonus[topic] || 0),
      });
    }
  }
  log(`sources ok=${ok} failed=${fail}, raw items=${out.length}`);
  return out;
}

// מאחד ידיעות זהות ממקורות שונים; ידיעה שמופיעה בכמה מקורות = חשובה יותר
function cluster(items) {
  const groups = [];
  for (const it of items.sort((a, b) => a.published.localeCompare(b.published))) {
    const w = words(it.title);
    const g = groups.find(g => g.id === it.id || jaccard(g.w, w) >= 0.55);
    if (g) {
      g.sources.add(it.source); g.score = Math.max(g.score, it.score);
      if (!g.summary && it.summary) g.summary = it.summary;
      if (!g.image && it.image) g.image = it.image;
    } else groups.push({ ...it, w, sources: new Set([it.source]) });
  }
  return groups.map(({ w, sources, ...g }) => {
    const n = sources.size;
    const s = g.score + (n >= 3 ? 3 : n === 2 ? 1 : 0);
    return { ...g, alsoIn: [...sources].filter(x => x && x !== g.source).slice(0, 4), important: s >= IMPORTANT_THRESHOLD };
  });
}

// ---------- הגדרות שהמשתמש שמר באפליקציה ----------
// האפליקציה שולחת את ההגדרות לערוץ ntfy פרטי; כאן אנחנו קוראים את האחרונות ושומרים אותן.
async function syncSettings() {
  const saved = readJSON('data/settings.json', {});
  if (!config.settingsTopic || FIXTURES) return saved;
  try {
    const txt = await get(`${NTFY}/${config.settingsTopic}/json?poll=1&since=24h`, { timeout: 10000 });
    const msgs = txt.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(m => m && m.event === 'message');
    let latest = null;
    for (const m of msgs) { try { const s = JSON.parse(m.message); if (s && s.v === 1 && (!latest || s.updated > latest.updated)) latest = s; } catch {} }
    if (latest && (!saved.updated || latest.updated > saved.updated)) {
      const clean = {
        updated: String(latest.updated),
        pushTopics: Object.fromEntries(Object.keys(TOPICS).map(t => [t, latest.pushTopics?.[t] !== false])),
        quietHours: {
          start: Math.min(23, Math.max(0, parseInt(latest.quietHours?.start ?? 23))),
          end: Math.min(23, Math.max(0, parseInt(latest.quietHours?.end ?? 7))),
          enabled: latest.quietHours?.enabled !== false,
        },
        maxPushesPerRun: Math.min(8, Math.max(1, parseInt(latest.maxPushesPerRun ?? 4))),
        onlyImportant: latest.onlyImportant !== false,
      };
      writeJSON('data/settings.json', clean);
      log('settings updated from app');
      return clean;
    }
  } catch (e) { log('settings sync failed:', e.message); }
  return saved;
}

// ---------- בקשות בדיקה שנשלחו מהאפליקציה ----------
// האפליקציה שולחת טענות לבדיקה לערוץ ntfy; כאן שומרים אותן ל-data/requests.json, ו-Claude בודק אותן בסבב הבא.
async function syncRequests() {
  const topic = config.ntfyTopic && config.ntfyTopic + '-requests';
  if (!topic || FIXTURES) return;
  const saved = readJSON('data/requests.json', { items: [] });
  const known = new Set(saved.items.map(r => r.id));
  try {
    const txt = await get(`${NTFY}/${topic}/json?poll=1&since=24h`, { timeout: 10000 });
    let added = 0;
    for (const l of txt.split('\n').filter(Boolean)) {
      let m; try { m = JSON.parse(l); } catch { continue; }
      if (m.event !== 'message' || known.has(m.id)) continue;
      let r; try { r = JSON.parse(m.message); } catch { r = { text: m.message }; }
      const str = (v, n) => String(v || '').slice(0, n);
      saved.items.push({ id: m.id, text: str(r.text, 2000), who: str(r.who, 200), link: str(r.link, 500), received: new Date(m.time * 1000).toISOString(), status: 'pending' });
      known.add(m.id); added++;
    }
    saved.items = saved.items.slice(-100);
    if (added || !fs.existsSync(P('data/requests.json'))) { writeJSON('data/requests.json', saved); log(`requests: +${added}`); }
  } catch (e) { log('requests sync failed:', e.message); }
}

// ---------- פושים ----------
function israelHour(d = new Date()) {
  return +new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hour12: false }).format(d) % 24;
}
function isQuiet(settings) {
  if (process.env.FORCE_AWAKE) return false;
  const q = settings.quietHours || config.quietHours || { start: 23, end: 7 };
  if (q.enabled === false || q.start === q.end) return false;
  const h = israelHour();
  return q.start > q.end ? (h >= q.start || h < q.end) : (h >= q.start && h < q.end);
}
async function push(msg) {
  const body = {
    topic: config.ntfyTopic, title: msg.title, message: msg.message,
    priority: msg.priority || 3,
    icon: APP_URL ? APP_URL + 'icons/icon-192.png' : undefined,
    click: msg.click || APP_URL || undefined,
    attach: msg.image || undefined,
    filename: msg.image ? 'dofek.jpg' : undefined,
  };
  if (DRY || !config.ntfyTopic) { log('  [push dry]', JSON.stringify({ t: body.title, m: body.message, img: body.attach, click: body.click })); return true; }
  try {
    const r = await fetch(NTFY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return true;
  } catch (e) { log('  push failed:', e.message); return false; }
}
const EMOJI = { econ: '📈', demo: '👥', deals: '🤝', research: '🔬', knesset: '🏛️', laws: '📜', factcheck: '🔍', media: '📺', israelAbroad: '🌍', defense: '🛡️', world: '🗺️' };
const card = (topic) => APP_URL ? `${APP_URL}icons/cards/${TOPICS[topic] ? topic : 'general'}.png` : '';

// כותרת ← סיכום ← תמונה. הנושא והמקור בשורה קטנה בסוף.
function toMsg(it, summaries) {
  const label = TOPICS[it.topic]?.label || '';
  if (it.kind === 'insight') {
    const tail = `${EMOJI[it.topic] || '🔍'} ניתוח של דופק · ${label}${it.verdict ? ' · ' + it.verdict : ''}`;
    return { title: it.title, message: `${clip(it.summary || '', 260)}\n\n${tail}`.trim(), image: card(it.topic), click: APP_URL ? `${APP_URL}#${it.id}` : undefined, priority: 4 };
  }
  const sum = summaries[it.id]?.summary || it.summary || '';
  const tail = `${EMOJI[it.topic] || '📰'} ${label} · ${it.source}${it.alsoIn?.length ? ' ועוד ' + it.alsoIn.length : ''}`;
  return { title: it.title, message: sum ? `${clip(sum, 260)}\n\n${tail}` : tail, image: it.image || card(it.topic), click: APP_URL ? `${APP_URL}#h-${it.id}` : it.url, priority: 3 };
}

// ---------- ראשי ----------
async function main() {
  const now = new Date();
  const feed = readJSON('data/feed.json', { updated: null, items: [] });
  const insights = readJSON('data/insights.json', { items: [] });
  const summaries = readJSON('data/summaries.json', {});
  const firstRun = !fs.existsSync(P('data/state.json'));
  const state = readJSON('data/state.json', { notified: [], pending: [] });
  const notified = new Set(state.notified);
  const settings = await syncSettings();
  await syncRequests();
  const pushTopics = settings.pushTopics || {};
  const wants = (it) => pushTopics[it.topic] !== false;

  const fresh = cluster(await collect());
  const byId = new Map(feed.items.map(i => [i.id, i]));
  let added = 0;
  for (const it of fresh) {
    // התאמה גם לפי דמיון כותרת לפריט קיים
    const w = words(it.title);
    const existing = byId.get(it.id) || feed.items.find(x => jaccard(words(x.title), w) >= 0.55);
    if (existing) {
      existing.alsoIn = [...new Set([...(existing.alsoIn || []), ...it.alsoIn, it.source])].filter(s => s && s !== existing.source).slice(0, 4);
      existing.important = existing.important || it.important;
      if (!existing.image && it.image) existing.image = it.image;
      if (!existing.summary && it.summary) existing.summary = it.summary;
    } else { feed.items.push(it); byId.set(it.id, it); added++; }
  }
  const cutoff = now - (config.keepDays || 5) * 864e5;
  feed.items = feed.items
    .filter(i => new Date(i.published) >= cutoff)
    .sort((a, b) => b.published.localeCompare(a.published))
    .slice(0, config.maxItems || 400);
  feed.updated = now.toISOString();
  log(`feed: +${added} new, total ${feed.items.length}`);

  // מה צריך לשלוח
  const all = [
    ...insights.items.filter(i => i.push !== false),
    ...feed.items.filter(i => settings.onlyImportant === false ? (i.score || 0) >= 1 : i.important),
  ].filter(i => !notified.has(i.id));
  const candidates = all.filter(wants);
  all.filter(i => !wants(i)).forEach(i => notified.add(i.id)); // נושאים שכובו — לא שולחים

  if (firstRun) {
    candidates.forEach(i => notified.add(i.id));
    await push({ title: 'דופק מחובר ✅', message: 'מעכשיו תקבל כאן את מה שחשוב: דמוגרפיה, מה נכון ומה לא, כלכלה, הכנסת, חוקים, ישראל בעולם ועוד.', image: card('general') });
  } else if (isQuiet(settings)) {
    state.pending = [...new Set([...(state.pending || []), ...candidates.map(i => i.id)])];
    candidates.forEach(i => notified.add(i.id));
    log(`quiet hours: queued ${candidates.length}`);
  } else {
    const byAll = new Map([...feed.items, ...insights.items].map(i => [i.id, i]));
    const pending = (state.pending || []).map(id => byAll.get(id)).filter(Boolean).filter(wants);
    if (pending.length) {
      const top = pending.sort((a, b) => (b.kind === 'insight') - (a.kind === 'insight') || (b.score || 0) - (a.score || 0)).slice(0, 5);
      await push({ title: `בזמן שישנת: ${pending.length} עדכונים חשובים`, message: top.map(i => `${EMOJI[i.topic] || '•'} ${i.title}`).join('\n'), image: card('general'), click: APP_URL || undefined });
    }
    state.pending = [];
    // ניתוחים קודם, אחר כך דמוגרפיה ובדיקות עובדות, ואז לפי ציון
    const pri = (i) => (i.kind === 'insight' ? 100 : 0) + (topicBonus[i.topic] || 0) * 3 + (i.score || 0);
    const order = candidates.sort((a, b) => pri(b) - pri(a));
    const max = settings.maxPushesPerRun || config.maxPushesPerRun || 4;
    const cut = order.length === max + 1 ? max + 1 : max; // לא שולחים "ועוד 1"
    const nowList = order.slice(0, cut), rest = order.slice(cut);
    for (const it of nowList) {
      if (it.kind !== 'insight' && !it.image) { it.image = await ogImage(it.url); }
      if (await push(toMsg(it, summaries))) notified.add(it.id);
    }
    if (rest.length) {
      await push({ title: `ועוד ${rest.length} עדכונים חשובים`, message: rest.slice(0, 6).map(i => `${EMOJI[i.topic] || '•'} ${i.title}`).join('\n'), image: card('general'), click: APP_URL || undefined });
      rest.forEach(i => notified.add(i.id));
    }
  }

  state.notified = [...notified].slice(-3000);
  state.lastRun = now.toISOString();
  writeJSON('data/feed.json', feed);
  writeJSON('data/state.json', state);
  if (!fs.existsSync(P('data/insights.json'))) writeJSON('data/insights.json', insights);
  if (!fs.existsSync(P('data/summaries.json'))) writeJSON('data/summaries.json', {});
}

main().catch(e => { console.error(e); process.exit(1); });
