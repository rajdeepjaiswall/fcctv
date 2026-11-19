/* FCCTV service worker: shows alert notifications on the owner's phone. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: "FCCTV alert", body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(d.title || "FCCTV alert", {
    body: d.body || "",
    icon: "/logo-icon.png",
    badge: "/favicon.png",
    image: d.image || undefined,
    tag: d.tag || undefined,
    renotify: true,
    requireInteraction: false,
    vibrate: [200, 100, 200],
    data: { url: d.url || "/alerts" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/alerts";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) { if ("focus" in c) { await c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  })());
});
