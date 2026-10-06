// שומר את האפליקציה במטמון כדי שתיפתח מהר וגם בלי אינטרנט
const CACHE = 'dofek-v8';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'config.json', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // תמיד מנסים קודם את הרשת (כדי לקבל חדשות טריות), ואם אין — מהמטמון
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request.url.split('?')[0], copy)); return r;
  }).catch(() => caches.match(e.request.url.split('?')[0])));
});

// ---- פושים ישירים מהאפליקציה (Web Push): לחיצה פותחת את האפליקציה עצמה ----
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'דופק אמיתי', body: e.data && e.data.text() }; }
  const base = self.registration.scope;
  e.waitUntil(self.registration.showNotification(d.title || 'דופק אמיתי', {
    body: d.body || '', icon: base + 'icons/icon-192.png', badge: base + 'icons/badge-96.png',
    image: d.image || undefined, tag: d.tag || undefined, dir: 'rtl', lang: 'he',
    data: { url: d.url || base },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil((async () => {
    const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) {
        await w.focus();
        w.postMessage({ type: 'open', url });
        return;
      }
    }
    await clients.openWindow(url);
  })());
});
