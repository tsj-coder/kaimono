// Service Worker。圏外でも画面を出す。下の版と一覧の2か所は、build-pwa.js が作るときに置き換える。
var BUILD = '20261119-150810';
var SHELL = ["./","api.js","app.js","build.js","icons/icon-180.png","icons/icon-192.png","icons/icon-512.png","img/index.json","index.html","logic.js","manifest.webmanifest","queue.js","shell.css","shell.js"];
var SHELL_CACHE = 'kaimono-shell-' + BUILD;
var IMG_PREFIX = 'kaimono-img-';
var FONT_CACHE = 'kaimono-font';
var FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
var IMG_BATCH = 20;

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      return cache.addAll(SHELL.map(function (url) { return new Request(url, { cache: 'reload' }); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key.indexOf('kaimono-shell-') === 0 && key !== SHELL_CACHE) return caches.delete(key);
        // 絵の保存場所は、新しい版を保存し終えたときに古いものを消す（cacheImages）
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

// 保存があればそれを返し、なければ取りに行って保存する
function cacheFirst(request, cacheName) {
  return caches.match(request).then(function (hit) {
    if (hit) return hit;
    return fetch(request).then(function (res) {
      if (res && (res.ok || res.type === 'opaque')) {
        var copy = res.clone();
        caches.open(cacheName).then(function (cache) { cache.put(request, copy); });
      }
      return res;
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url = new URL(request.url);
  if (FONT_HOSTS.indexOf(url.hostname) >= 0) {
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(caches.match('index.html').then(function (hit) { return hit || fetch(request); }));
    return;
  }
  event.respondWith(cacheFirst(request, SHELL_CACHE));
});

// 絵を、まだない分だけ20枚ずつ保存する。1枚の失敗で全体を止めない
function cacheImages(version, urls) {
  var name = IMG_PREFIX + version;
  return caches.open(name).then(function (cache) {
    return cache.keys().then(function (existing) {
      var have = {};
      existing.forEach(function (r) { have[r.url] = true; });
      var todo = urls.filter(function (u) { return !have[new URL(u, self.registration.scope).href]; });
      var chain = Promise.resolve();
      for (var i = 0; i < todo.length; i += IMG_BATCH) {
        (function (batch) {
          chain = chain.then(function () {
            return Promise.all(batch.map(function (u) {
              return cache.add(u).catch(function () { /* 取れなかった1枚は次の機会に */ });
            }));
          });
        })(todo.slice(i, i + IMG_BATCH));
      }
      return chain;
    });
  }).then(function () {
    // 古い版の絵の保存を消す
    return caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        return key.indexOf(IMG_PREFIX) === 0 && key !== name ? caches.delete(key) : null;
      }));
    });
  });
}

self.addEventListener('message', function (event) {
  var data = event.data;
  if (!data || data.type !== 'cache-images' || !Array.isArray(data.urls)) return;
  event.waitUntil(cacheImages(String(data.version), data.urls));
});
