// קריאת התוכן שמאחורי קישור (ציוץ ב-X, הודעה בטלגרם, כתבה) — כדי ש-Claude יבדוק את הכתוב בדיוק כפי שפורסם
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

async function get(url, { json = false, timeout = 15000 } = {}) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': UA, 'Accept-Language': 'he,en;q=0.8' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return json ? await r.json() : await r.text();
  } finally { clearTimeout(t); }
}

export const decode = s => String(s || '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

const meta = (html, name) => {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i'));
  return m ? decode((m[0].match(/content=["']([^"']*)["']/i) || [])[1]) : '';
};

async function readX(url) {
  const m = url.match(/(?:x|twitter)\.com\/([^/?#]+)\/status(?:es)?\/(\d+)/i);
  if (!m) throw new Error('not a tweet link');
  try {
    const j = await get(`https://api.fxtwitter.com/${m[1]}/status/${m[2]}`, { json: true });
    const t = j.tweet; if (!t) throw new Error('no tweet');
    let text = t.text || '';
    if (t.quote) text += `\n\n[ציטוט של @${t.quote.author?.screen_name}]: ${t.quote.text || ''}`;
    if (t.media?.videos?.length) text += '\n\n[בציוץ יש סרטון]';
    return { kind: 'x', title: `ציוץ של ${t.author?.name || m[1]} (@${t.author?.screen_name || m[1]})`, author: t.author?.name || m[1], date: t.created_at ? new Date(t.created_at).toISOString() : '', text };
  } catch (e) {
    const j = await get(`https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(`https://twitter.com/${m[1]}/status/${m[2]}`)}`, { json: true });
    const text = decode((j.html || '').replace(/&mdash;[\s\S]*$/, ''));
    return { kind: 'x', title: `ציוץ של ${j.author_name || m[1]}`, author: j.author_name || m[1], date: '', text };
  }
}

async function readTelegram(url) {
  const m = url.match(/t\.me\/(?:s\/)?([A-Za-z0-9_]+)\/(\d+)/);
  if (!m) throw new Error('not a telegram post link');
  const html = await get(`https://t.me/${m[1]}/${m[2]}?embed=1&mode=tme`);
  const text = decode((html.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1]);
  if (!text) throw new Error('empty');
  const author = decode((html.match(/<span dir="auto">([\s\S]*?)<\/span>/) || [])[1]) || m[1];
  const date = (html.match(/<time[^>]+datetime="([^"]+)"/) || [])[1] || '';
  return { kind: 'telegram', title: `הודעה בטלגרם · ${author}`, author, date, text };
}

async function readArticle(url) {
  const html = await get(url);
  const title = meta(html, 'og:title') || decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const desc = meta(html, 'og:description') || meta(html, 'description');
  const date = meta(html, 'article:published_time') || (html.match(/"datePublished"\s*:\s*"([^"]+)"/) || [])[1] || '';
  const author = meta(html, 'author') || (html.match(/"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/) || [])[1] || '';
  const body = html.replace(/<(script|style|noscript|nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, '');
  const scope = (body.match(/<article[\s\S]*?<\/article>/i) || [body])[0];
  const paras = [...scope.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(p => decode(p[1])).filter(p => p.length > 40);
  const text = [desc, ...paras].filter((p, i, a) => p && a.indexOf(p) === i).join('\n');
  if (text.length < 80) throw new Error('no readable text (maybe paywall or app-only)');
  return { kind: 'article', title, author, date, text };
}

// מחזיר { kind, title, author, date, text } או זורק שגיאה
export async function readLink(url) {
  if (/(^|\/\/|\.)(x|twitter)\.com\//i.test(url)) return readX(url);
  if (/\/\/t\.me\//i.test(url)) return readTelegram(url);
  if (/tiktok\.com|youtube\.com|youtu\.be|instagram\.com|facebook\.com/i.test(url)) throw new Error('video site — handled by transcriber');
  return readArticle(url);
}

if (process.argv[1] && process.argv[1].endsWith('linkread.mjs') && process.argv[2]) {
  readLink(process.argv[2]).then(r => console.log(JSON.stringify({ ...r, text: r.text.slice(0, 800) }, null, 1)), e => console.log('ERR', e.message));
}
