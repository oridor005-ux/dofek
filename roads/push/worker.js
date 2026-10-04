// "עבודות בדרך" — שרת ההתראות (Cloudflare Worker)
// כל רבע שעה: קורא את מאגר העבודות, בודק את המסלולים של כל מי שהפעיל התראות, ושולח פוש בזמן שהמשתמש בחר.
// בשרת נשמרים רק: כתובת הפוש של הטלפון, והכבישים/ימים/שעות של המסלולים. בלי שם, בלי מוצא ויעד, בלי מספר טלפון.

const APP_URL = "https://oridor005-ux.github.io/dofek/roads/";
const ALLOWED_ORIGIN = "https://oridor005-ux.github.io";
const WORKS_URL = APP_URL + "works.json";
const MAX_ROUTES = 20;
const HORIZON_DAYS = 14;
// רק שירותי הפוש הרשמיים של הדפדפנים מורשים, כדי שאי אפשר יהיה לגרום לשרת לפנות לכתובות אחרות
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /^web\.push\.apple\.com$/, /\.push\.apple\.com$/];

const CLOSURE = { one: "נתיב אחד סגור", two: "שני נתיבים סגורים", full: "סגירה מלאה", slow: "האטה ועבודות בשוליים" };
const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/* ---------- זמן ישראל ----------
   כל החישובים נעשים ב"שעון קיר" של ישראל: תאריך/שעה מקומיים נשמרים כאילו היו UTC. */
function ilNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute));
}
function at(dateStr, time) {
  const [y, m, d] = dateStr.split("-").map(Number); const [h, mi] = (time || "00:00").split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, mi));
}
function iso(d) { return d.toISOString().slice(0, 10); }
function hhmm(d) { return d.toISOString().slice(11, 16); }
function dayLabel(d, now) {
  const diff = Math.round((at(iso(d), "00:00") - at(iso(now), "00:00")) / 86400000);
  if (diff === 0) return "היום";
  if (diff === 1) return "מחר";
  return `ביום ${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
}

/* ---------- התאמה בין עבודות למסלולים (אותה לוגיקה כמו באפליקציה) ---------- */
function workWindows(w) {
  const out = []; const s = at(w.startDate), e = at(w.endDate || w.startDate);
  if (w.allDay) { const end = new Date(e); end.setUTCDate(end.getUTCDate() + 1); out.push([s, end]); return out; }
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    const a = at(iso(d), w.fromTime); let b = at(iso(d), w.toTime);
    if (b <= a) b.setUTCDate(b.getUTCDate() + 1);
    out.push([a, b]);
  }
  return out;
}
function routeConflicts(r, works, today) {
  const out = [];
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const d = new Date(today); d.setUTCDate(d.getUTCDate() + i);
    if (!r.days.includes(d.getUTCDay())) continue;
    const start = at(iso(d), r.dep); const end = new Date(start.getTime() + r.dur * 60000);
    for (const w of works) {
      if (!r.roads.includes(w.road)) continue;
      for (const [a, b] of workWindows(w)) { if (a < end && b > start) { out.push({ work: w, date: start }); break; } }
    }
  }
  return out;
}
function alertTime(r, date) {
  const d = new Date(date);
  if (r.lead === "week") { d.setUTCDate(d.getUTCDate() - 7); d.setUTCHours(18, 0, 0, 0); }
  else if (r.lead === "morning") { d.setUTCHours(6, 30, 0, 0); }
  else if (r.lead === "hour") { d.setTime(d.getTime() - 3600000); }
  else { d.setUTCDate(d.getUTCDate() - 1); d.setUTCHours(20, 0, 0, 0); } // "day" — ערב לפני
  return d;
}
function lineFor(c, now) {
  const w = c.work;
  const hours = w.allDay ? "כל היום" : `${w.fromTime}–${w.toTime}`;
  return `${dayLabel(c.date, now)} ב-${hhmm(c.date)}: ${CLOSURE[w.closure] || "עבודות"} בכביש ${w.road} (${w.section}${w.dir ? ", " + w.dir : ""}, ${hours})${w.detour ? `. חלופה: ${w.detour}` : ""}`;
}

/* ---------- Web Push (VAPID) ---------- */
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = new TextEncoder();

async function vapidKeys(env) {
  let k = await env.KV.get("vapid", "json");
  if (!k) {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    k = { privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey), publicKey: b64u(await crypto.subtle.exportKey("raw", pair.publicKey)) };
    await env.KV.put("vapid", JSON.stringify(k));
  }
  return k;
}
async function vapidHeader(env, endpoint) {
  const k = await vapidKeys(env);
  const key = await crypto.subtle.importKey("jwk", k.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: APP_URL })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + body));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${k.publicKey}`;
}
// הפוש עצמו ריק; הטלפון מושך את תוכן ההודעה מ-/inbox. כך לא צריך להצפין את התוכן בשרת.
async function sendPush(env, endpoint) {
  const r = await fetch(endpoint, { method: "POST", headers: { Authorization: await vapidHeader(env, endpoint), TTL: "86400", Urgency: "high", "Content-Length": "0" } });
  return r.status;
}

/* ---------- אחסון ---------- */
async function subId(endpoint) {
  const h = await crypto.subtle.digest("SHA-256", enc.encode(endpoint));
  return [...new Uint8Array(h)].slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join("");
}
function validEndpoint(u) {
  try { const x = new URL(u); return x.protocol === "https:" && u.length < 1000 && PUSH_HOSTS.some(re => re.test(x.hostname)); } catch { return false; }
}
function cleanRoutes(list) {
  if (!Array.isArray(list)) return [];
  const T = /^\d{2}:\d{2}$/;
  return list.slice(0, MAX_ROUTES).map(r => ({
    id: String(r.id || "").replace(/[^\w-]/g, "").slice(0, 30),
    roads: (Array.isArray(r.roads) ? r.roads : []).map(n => String(n).replace(/\D/g, "")).filter(n => n && n.length <= 4).slice(0, 20),
    days: (Array.isArray(r.days) ? r.days : []).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6),
    dep: T.test(r.dep) ? r.dep : "08:00",
    dur: Math.min(600, Math.max(5, Number(r.dur) || 40)),
    lead: ["week", "day", "morning", "hour"].includes(r.lead) ? r.lead : "day",
    freq: ["instant", "daily", "weekly"].includes(r.freq) ? r.freq : "daily"
  })).filter(r => r.id && r.roads.length && r.days.length);
}

/* ---------- הבדיקה התקופתית ---------- */
async function loadWorks() {
  const r = await fetch(WORKS_URL + "?t=" + Date.now(), { cf: { cacheTtl: 0 } });
  if (!r.ok) throw new Error("works " + r.status);
  const j = await r.json();
  const T = /^\d{2}:\d{2}$/, D = /^\d{4}-\d{2}-\d{2}$/;
  return (Array.isArray(j.works) ? j.works : []).filter(w => w && w.status !== "pending" && /^\d{1,4}$/.test(String(w.road)) && D.test(w.startDate) && D.test(w.endDate || w.startDate) && (w.allDay || (T.test(w.fromTime) && T.test(w.toTime))))
    .map(w => ({ ...w, road: String(w.road), id: String(w.id || `${w.road}-${w.startDate}-${(w.section || "").slice(0, 20)}`), section: String(w.section || "").slice(0, 80), detour: String(w.detour || "").slice(0, 60), dir: String(w.dir || "").slice(0, 20) }));
}

async function checkAll(env) {
  const works = await loadWorks();
  const now = ilNow(); const today = at(iso(now), "00:00");
  let cursor, sent = 0, subs = 0, removed = 0;
  do {
    const page = await env.KV.list({ prefix: "sub:", cursor });
    cursor = page.list_complete ? null : page.cursor;
    for (const k of page.keys) {
      subs++;
      const s = await env.KV.get(k.name, "json"); if (!s) continue;
      const res = await checkOne(env, s, works, now, today);
      if (res === "gone") { await env.KV.delete(k.name); removed++; } else if (res) sent++;
    }
  } while (cursor);
  await env.KV.put("meta:lastCheck", JSON.stringify({ at: new Date().toISOString(), works: works.length, subs, sent, removed }));
  return { works: works.length, subs, sent, removed };
}

async function checkOne(env, s, works, now, today) {
  const done = new Set(s.sent || []); const lines = [];
  for (const r of s.routes || []) {
    for (const c of routeConflicts(r, works, today)) {
      if (c.date <= now) continue;
      const key = `${c.work.id}|${iso(c.date)}|${r.id}`;
      const due = alertTime(r, c.date) <= now;
      const fresh = r.freq === "instant" && !done.has("n:" + key);
      if (fresh) done.add("n:" + key);
      if (due && !done.has("r:" + key)) { done.add("r:" + key); done.add("n:" + key); lines.push(lineFor(c, now)); }
      else if (fresh) lines.push("חדש: " + lineFor(c, now));
    }
    // סיכום שבועי: מוצאי שבת מ-20:00
    if (r.freq === "weekly" && now.getUTCDay() === 6 && now.getUTCHours() >= 20) {
      const wk = "w:" + iso(now) + "|" + r.id;
      if (!done.has(wk)) {
        done.add(wk);
        const next = routeConflicts(r, works, today).filter(c => c.date > now && c.date - now < 7 * 86400000);
        if (next.length) lines.push(`בשבוע הקרוב ${next.length} נסיעות מושפעות. הראשונה: ` + lineFor(next[0], now));
      }
    }
  }
  if (!lines.length) return false;
  const uniq = [...new Set(lines)];
  const msg = {
    title: uniq.length === 1 ? "⚠️ עבודות במסלול שלך" : `⚠️ ${uniq.length} עבודות במסלולים שלך`,
    body: uniq.slice(0, 3).join("\n") + (uniq.length > 3 ? `\nועוד ${uniq.length - 3} — פתח את האפליקציה` : ""),
    tag: "avodot-" + iso(now) + "-" + hhmm(now)
  };
  s.inbox = [...(s.inbox || []), msg].slice(-10);
  s.sent = [...done].slice(-500);
  const status = await sendPush(env, s.endpoint);
  if (status === 404 || status === 410) return "gone";
  await env.KV.put("sub:" + await subId(s.endpoint), JSON.stringify(s));
  return status < 300;
}

/* ---------- בדיקת מקורות (האם האתרים של הרשויות נפתחים מכאן) ---------- */
async function probe() {
  const urls = ["https://www.iroads.co.il/", "https://www.ayalonhw.co.il/company-activity/events/", "https://www.nta.co.il/"];
  const out = {};
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Mobile Safari/537.36", "Accept-Language": "he-IL,he;q=0.9" } });
      const t = await r.text(); out[u] = { status: r.status, bytes: t.length, blocked: /captcha|access denied|cf-chl|Request unsuccessful|Incapsula/i.test(t) };
    } catch (e) { out[u] = { error: String(e).slice(0, 100) }; }
  }
  return out;
}

/* ---------- כתובות ה-API שהאפליקציה פונה אליהן ---------- */
function cors(origin) {
  return { "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "null", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...cors(origin) } });
}
async function body(req) {
  const t = await req.text(); if (t.length > 20000) throw new Error("too large");
  return JSON.parse(t || "{}");
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url); const origin = req.headers.get("Origin") || "";
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
    try {
      if (url.pathname === "/key" && req.method === "GET") return json({ publicKey: (await vapidKeys(env)).publicKey }, 200, origin);
      if (url.pathname === "/health") return json({ ok: true, last: await env.KV.get("meta:lastCheck", "json") }, 200, origin);
      if (url.pathname === "/probe") return json(await probe(), 200, origin);
      if (req.method !== "POST") return json({ error: "not found" }, 404, origin);

      const b = await body(req);
      const endpoint = b.subscription ? b.subscription.endpoint : b.endpoint;
      if (!validEndpoint(endpoint)) return json({ error: "bad endpoint" }, 400, origin);
      const key = "sub:" + await subId(endpoint);

      if (url.pathname === "/subscribe") {
        // כתיבה רק מהאפליקציה עצמה
        if (origin !== ALLOWED_ORIGIN) return json({ error: "forbidden" }, 403, origin);
        const old = await env.KV.get(key, "json") || {};
        const s = { endpoint, routes: cleanRoutes(b.routes), sent: old.sent || [], inbox: old.inbox || [], created: old.created || new Date().toISOString(), updated: new Date().toISOString() };
        await env.KV.put(key, JSON.stringify(s));
        return json({ ok: true, routes: s.routes.length }, 200, origin);
      }
      if (url.pathname === "/unsubscribe") { await env.KV.delete(key); return json({ ok: true }, 200, origin); }
      if (url.pathname === "/inbox") {
        const s = await env.KV.get(key, "json"); if (!s) return json({ messages: [] }, 200, origin);
        const messages = s.inbox || [];
        if (messages.length) { s.inbox = []; await env.KV.put(key, JSON.stringify(s)); }
        return json({ messages }, 200, origin);
      }
      if (url.pathname === "/test") {
        if (origin !== ALLOWED_ORIGIN) return json({ error: "forbidden" }, 403, origin);
        const s = await env.KV.get(key, "json"); if (!s) return json({ error: "not subscribed" }, 404, origin);
        s.inbox = [...(s.inbox || []), { title: "✅ ההתראות עובדות", body: "מעכשיו תקבל כאן התראה כשמתוכננות עבודות במסלולים שלך.", tag: "avodot-test" }].slice(-10);
        await env.KV.put(key, JSON.stringify(s));
        return json({ ok: true, status: await sendPush(env, endpoint) }, 200, origin);
      }
      return json({ error: "not found" }, 404, origin);
    } catch (e) {
      return json({ error: "server error" }, 500, origin);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkAll(env).catch(async e => env.KV.put("meta:lastError", JSON.stringify({ at: new Date().toISOString(), error: String(e).slice(0, 200) }))));
  }
};

// לבדיקות מקומיות
export { routeConflicts, alertTime, checkOne, cleanRoutes, validEndpoint, vapidHeader, ilNow, at, lineFor };
