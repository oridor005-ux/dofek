// מעקב אחרי ערוצי טלגרם ציבוריים (דרך t.me/s/<ערוץ>, בלי התחברות).
// הודעות חדשות נשמרות ב-data/telegram.json במצב "new", ו-Claude עובר עליהן ובודק טענות עובדתיות.
import fs from 'node:fs';
import path from 'node:path';
import { decode } from './linkread.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const P = f => path.join(ROOT, f);
const config = JSON.parse(fs.readFileSync(P('config.json'), 'utf8'));
const FILE = P('data/telegram.json');
const db = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { channels: {}, posts: [] };
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const KEEP_DAYS = 4, MAX_POSTS = 900, FIRST_TIME = 5, MIN_LEN = 50;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function page(h) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`https://t.me/s/${h}`, { signal: ctrl.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'he,en' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return { html: await r.text(), finalUrl: r.url };
  } finally { clearTimeout(t); }
}

const known = new Set(db.posts.map(p => p.id));
let ok = 0, fail = 0, added = 0;
for (const ch of config.telegramChannels || []) {
  const h = ch.handle;
  const info = db.channels[h] || (db.channels[h] = {});
  try {
    const { html, finalUrl } = await page(h);
    if (!/\/s\//.test(finalUrl) || !html.includes('tgme_widget_message ')) throw new Error('not found or preview disabled');
    info.title = decode((html.match(/tgme_channel_info_header_title[^>]*>([\s\S]*?)<\/div>/) || [])[1]).slice(0, 120);
    info.subscribers = decode((html.match(/<span class="counter_value">([^<]+)<\/span>\s*<span class="counter_type">(?:subscribers|מנויים)/) || [])[1]);
    const msgs = [...html.matchAll(/<div class="tgme_widget_message [^"]*"[^>]*data-post="([^"]+)"([\s\S]*?)(?=<div class="tgme_widget_message_wrap|$)/g)];
    const firstTime = !info.lastId;
    let batch = [];
    for (const [, post, body] of msgs) {
      const num = +post.split('/')[1];
      if (num <= (info.lastId || 0) || known.has(post)) continue;
      const text = decode((body.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1]);
      const date = (body.match(/<time[^>]+datetime="([^"]+)"/) || [])[1] || '';
      const hasVideo = /tgme_widget_message_video/.test(body);
      batch.push({ id: post, num, text, date, hasVideo });
    }
    const top = Math.max(info.lastId || 0, ...msgs.map(m => +m[1].split('/')[1]));
    if (firstTime) batch = batch.slice(-FIRST_TIME);
    for (const b of batch) {
      if (b.text.length < MIN_LEN) continue; // הודעות קצרות מדי (תמונה בלי טקסט, "עדכון קצר") — אין מה לבדוק
      db.posts.push({ id: b.id, channel: h, name: info.title || h, url: `https://t.me/${b.id}`, date: b.date, text: b.text.slice(0, 4000), hasVideo: b.hasVideo || undefined, status: 'new' });
      known.add(b.id); added++;
    }
    info.lastId = top; info.ok = true; info.error = undefined; info.checkedAt = new Date().toISOString(); ok++;
  } catch (e) { info.ok = false; info.error = String(e.message).slice(0, 80); info.checkedAt = new Date().toISOString(); fail++; }
  await sleep(400);
}
// ערוצים שהוסרו מהרשימה
for (const h of Object.keys(db.channels)) if (!(config.telegramChannels || []).some(c => c.handle === h)) delete db.channels[h];
const cutoff = Date.now() - KEEP_DAYS * 864e5;
db.posts = db.posts.filter(p => new Date(p.date || Date.now()) > cutoff).slice(-MAX_POSTS);
db.health = { at: new Date().toISOString(), ok, fail, added, pendingNew: db.posts.filter(p => p.status === 'new').length };
fs.writeFileSync(FILE, JSON.stringify(db, null, 1));
console.log(`telegram: ${ok} ok, ${fail} failed, +${added} posts`);
