// "דופק" — אוסף כותרות, מסווג, מסמן חשובות ושולח פושים דרך ntfy.
// רץ ב-GitHub Actions כל חצי שעה. ללא תלויות חיצוניות (Node 20+).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  TOPICS, directFeeds, googleQueries, googleNewsUrl,
  topicKeywords, importantKeywords, IMPORTANT_THRESHOLD,
} from './sources.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const P = (...a) => path.join(ROOT, ...a);
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(P(f), 'utf8')); } catch { return d; } };
const writeJSON = (f, v) => fs.writeFileSync(P(f), JSON.stringify(v, null, 1) + '\n');

const config = readJSON('config.json', {});
const DRY = !!process.env.DRY_RUN;            // לא שולח פושים באמת
const FIXTURES = process.env.FIXTURES;        // תיקייה עם קבצי XML לבדיקה מקומית
const APP_URL = process.env.APP_URL || '';
const log = (...a) => console.log(...a);

// ---------- RSS ----------
const decode = (s = '') => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? m[1] : ''; };

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
    });
  }
  return items;
}

async function getXml(url, fixtureName) {
  if (FIXTURES) {
    const f = path.join(FIXTURES, fixtureName);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (DofekBot; personal news reader)', 'Accept': 'application/rss+xml, application/xml, text/xml, */*' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

// ---------- עזרי טקסט ----------
const norm = (s) => s.replace(/["'״׳`,.:;!?()\[\]\-–—|]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const words = (s) => new Set(norm(s).split(' ').filter(w => w.length > 1));
const jaccard = (a, b) => { let i = 0; for (const w of a) if (b.has(w)) i++; return i / (a.size + b.size - i || 1); };
const idOf = (title) => crypto.createHash('sha1').update(norm(title)).digest('hex').slice(0, 12);

function classify(text) {
  for (const [topic, kws] of Object.entries(topicKeywords)) if (kws.some(k => text.includes(k))) return topic;
  return null;
}
function score(text) { return importantKeywords.reduce((s, { k, w }) => s + (text.includes(k) ? w : 0), 0); }

// ---------- איסוף ----------
async function collect() {
  const jobs = [
    ...directFeeds.map((f, i) => ({ ...f, fixture: `direct-${i}.xml` })),
    ...googleQueries.map((g, i) => ({ name: null, url: googleNewsUrl(g.q), topic: g.topic, fixture: `google-${i}.xml`, google: true })),
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
      if (!title || !it.link) continue;
      const text = title + ' ' + (j.google ? '' : it.description);
      const topic = j.topic && j.topic !== 'econ' ? j.topic : (classify(text) || j.topic);
      if (!topic) continue; // לא רלוונטי לנושאים שלנו
      const d = new Date(it.pubDate);
      out.push({
        id: idOf(title), kind: 'headline', title, source: source || '', url: it.link, topic,
        published: isNaN(d) ? new Date().toISOString() : d.toISOString(),
        summary: j.google ? '' : it.description.slice(0, 220),
        score: score(text),
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
    if (g) { g.sources.add(it.source); g.score = Math.max(g.score, it.score); if (!g.summary && it.summary) g.summary = it.summary; }
    else groups.push({ ...it, w, sources: new Set([it.source]) });
  }
  return groups.map(({ w, sources, ...g }) => {
    const n = sources.size;
    const s = g.score + (n >= 3 ? 3 : n === 2 ? 1 : 0);
    return { ...g, alsoIn: [...sources].filter(x => x && x !== g.source).slice(0, 4), important: s >= IMPORTANT_THRESHOLD };
  });
}

// ---------- פושים ----------
function israelHour(d = new Date()) {
  return +new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hour12: false }).format(d) % 24;
}
function isQuiet() {
  if (process.env.FORCE_AWAKE) return false;
  const { start = 23, end = 7 } = config.quietHours || {};
  const h = israelHour();
  return start > end ? (h >= start || h < end) : (h >= start && h < end);
}
async function push(msg) {
  const body = {
    topic: config.ntfyTopic, title: msg.title, message: msg.message,
    tags: msg.tags || [], priority: msg.priority || 3,
    icon: APP_URL ? APP_URL + 'icons/icon-192.png' : undefined,
    click: msg.click || APP_URL || undefined,
    actions: APP_URL && msg.click && msg.click !== APP_URL ? [{ action: 'view', label: 'פתח בדופק', url: APP_URL }] : undefined,
  };
  if (DRY || !config.ntfyTopic) { log('  [push dry]', body.title, '|', body.message.slice(0, 80)); return true; }
  try {
    const r = await fetch(config.ntfyServer || 'https://ntfy.sh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return true;
  } catch (e) { log('  push failed:', e.message); return false; }
}
const TAG = { econ: 'chart_with_upwards_trend', demo: 'busts_in_silhouette', deals: 'handshake', research: 'microscope', knesset: 'classical_building', laws: 'scroll', factcheck: 'mag' };
const toMsg = (it) => it.kind === 'insight'
  ? { title: `🔍 ${TOPICS[it.topic]?.label || 'ניתוח'}: ${it.title}`, message: it.summary || it.title, click: APP_URL ? `${APP_URL}#${it.id}` : undefined, tags: [TAG[it.topic] || 'bulb'], priority: 4 }
  : { title: it.title, message: `${it.source}${it.alsoIn?.length ? ' · וגם ב' + it.alsoIn.join(', ') : ''} · ${TOPICS[it.topic]?.label || ''}`, click: it.url, tags: [TAG[it.topic] || 'newspaper'], priority: 3 };

// ---------- ראשי ----------
async function main() {
  const now = new Date();
  const feed = readJSON('data/feed.json', { updated: null, items: [] });
  const insights = readJSON('data/insights.json', { items: [] });
  const firstRun = !fs.existsSync(P('data/state.json'));
  const state = readJSON('data/state.json', { notified: [], pending: [] });
  const notified = new Set(state.notified);

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
  const candidates = [
    ...insights.items.filter(i => i.push !== false),
    ...feed.items.filter(i => i.important),
  ].filter(i => !notified.has(i.id));

  if (firstRun) {
    candidates.forEach(i => notified.add(i.id));
    await push({ title: 'דופק מחובר ✅', message: 'מעכשיו תקבל כאן עדכונים חשובים על כלכלה, דמוגרפיה, עסקאות, מחקרים, הכנסת וחוקים חדשים.', tags: ['wave'] });
  } else if (isQuiet()) {
    state.pending = [...new Set([...(state.pending || []), ...candidates.map(i => i.id)])];
    candidates.forEach(i => notified.add(i.id));
    log(`quiet hours: queued ${candidates.length}`);
  } else {
    const all = new Map([...feed.items, ...insights.items].map(i => [i.id, i]));
    const pending = (state.pending || []).map(id => all.get(id)).filter(Boolean);
    if (pending.length) {
      const top = pending.sort((a, b) => (b.kind === 'insight') - (a.kind === 'insight')).slice(0, 4);
      await push({ title: `☀️ בזמן שישנת: ${pending.length} עדכונים חשובים`, message: top.map(i => '• ' + i.title).join('\n'), tags: ['sunrise'] });
      state.pending = [];
    }
    // ניתוחים קודם, ואז כותרות חשובות לפי ציון
    const order = candidates.sort((a, b) => (b.kind === 'insight') - (a.kind === 'insight') || (b.score || 0) - (a.score || 0));
    const max = config.maxPushesPerRun || 4;
    const now_ = order.slice(0, max), rest = order.slice(max);
    for (const it of now_) if (await push(toMsg(it))) notified.add(it.id);
    if (rest.length) {
      await push({ title: `ועוד ${rest.length} עדכונים חשובים`, message: rest.slice(0, 5).map(i => '• ' + i.title).join('\n'), tags: ['newspaper'] });
      rest.forEach(i => notified.add(i.id));
    }
  }

  state.notified = [...notified].slice(-3000);
  state.lastRun = now.toISOString();
  writeJSON('data/feed.json', feed);
  writeJSON('data/state.json', state);
  if (!fs.existsSync(P('data/insights.json'))) writeJSON('data/insights.json', insights);
}

main().catch(e => { console.error(e); process.exit(1); });
