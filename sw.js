/* Ancien service worker de l'Atelier (racine du site) : il se retire tout seul.
   L'Atelier vit désormais dans /atelier/ et le lanceur CAIRN dans /cairn/. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => /^atelier-1\.0\.[0-4]$/.test(k)).map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .catch(() => {})
  );
});
