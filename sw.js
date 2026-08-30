const CACHE = "munjang-v1.5";
const APP_SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./highlighter.js", "./manifest.webmanifest", "./icons/icon-192.svg", "./icons/icon-512.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

async function networkFirst(request) {
  try {
    const response = await fetch(request, { cache: "no-store" });
    const clone = response.clone();
    caches.open(CACHE).then(cache => cache.put(request, clone));
    return response;
  } catch {
    return (await caches.match(request)) || (await caches.match("./index.html"));
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  if (event.request.mode === "navigate" || /\.(?:js|css)$/.test(url.pathname)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      const clone = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, clone));
      return response;
    }))
  );
});
