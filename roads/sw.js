// שומר את האפליקציה במטמון כדי שתיפתח מהר וגם בלי אינטרנט, ומציג התראות
const CACHE = 'avodot-v2';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'works.json', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('avodot-') && k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || !u.pathname.includes('/roads/')) return;
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request.url.split('?')[0], copy)); return r;
  }).catch(() => caches.match(e.request.url.split('?')[0])));
});

// התראה: הפוש מגיע ריק, ואת התוכן מושכים מהשרת
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let msgs = [];
    try {
      const cfg = await (await fetch('push-config.json?t=' + Date.now(), { cache: 'no-store' })).json();
      const sub = await self.registration.pushManager.getSubscription();
      if (cfg.api && sub) {
        const r = await fetch(cfg.api + '/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        msgs = ((await r.json()).messages || []).filter(m => m && typeof m.title === 'string');
      }
    } catch (err) {}
    if (!msgs.length) msgs = [{ title: 'עבודות בדרך', body: 'יש עדכון על המסלולים שלך. לחץ לפרטים.', tag: 'avodot' }];
    for (const m of msgs.slice(-3)) {
      await self.registration.showNotification(String(m.title).slice(0, 80), {
        body: String(m.body || '').slice(0, 400), tag: String(m.tag || 'avodot').slice(0, 60),
        icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', lang: 'he', dir: 'rtl', data: { url: './' }
      });
    }
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) if (c.url.includes('/roads/')) return c.focus();
    return clients.openWindow('./');
  })());
});
