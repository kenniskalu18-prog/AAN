// AMSUL Alumni Onboarding Database — Service Worker
// Recreated after the original GitHub repo was lost. Two jobs:
//   1. Cache the app shell so the site loads instantly on repeat visits
//      and still opens (read-only) if the network drops.
//   2. Receive and display push notifications for the app's real-time
//      alerts feature, matching what index.html already expects.

const CACHE_NAME = 'amsul-alumni-v1';
const APP_SHELL = [
    './',
    'index.html',
    'apply.html',
    'manifest.json',
    'icon-192.png',
    'icon-180.png',
    'favicon-32.png'
];

// ---------- INSTALL: pre-cache the app shell ----------
self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function (cache) {
                // Each file is cached individually so one missing/renamed
                // file (e.g. an icon that hasn't been re-uploaded yet)
                // can't fail the whole install.
                return Promise.all(
                    APP_SHELL.map(function (url) {
                        return cache.add(url).catch(function () {});
                    })
                );
            })
            .then(function () { return self.skipWaiting(); })
    );
});

// ---------- ACTIVATE: clear out old cache versions ----------
self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(
                keys.filter(function (key) { return key !== CACHE_NAME; })
                    .map(function (key) { return caches.delete(key); })
            );
        }).then(function () { return self.clients.claim(); })
    );
});

// ---------- FETCH: network-first for HTML (so data/edits are always
// fresh), cache-first for everything else (fonts, icons, libraries) ----------
self.addEventListener('fetch', function (event) {
    const req = event.request;
    if (req.method !== 'GET') return;

    const isHTML = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

    if (isHTML) {
        event.respondWith(
            fetch(req)
                .then(function (res) {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
                    return res;
                })
                .catch(function () { return caches.match(req).then(function (m) { return m || caches.match('index.html'); }); })
        );
        return;
    }

    event.respondWith(
        caches.match(req).then(function (cached) {
            if (cached) return cached;
            return fetch(req).then(function (res) {
                if (res && res.status === 200 && res.type === 'basic') {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
                }
                return res;
            }).catch(function () {});
        })
    );
});

// ---------- PUSH: show the notification, then tell any open tab ----------
self.addEventListener('push', function (event) {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (e) {
        data = { title: 'AMSUL Alumni Database', body: event.data ? event.data.text() : 'You have a new alert.' };
    }

    const title = data.title || 'AMSUL Alumni Database';
    const options = {
        body: data.body || 'You have a new alert.',
        icon: data.icon || 'icon-192.png',
        badge: data.badge || 'favicon-32.png',
        data: data.url || '/',
        tag: data.tag || undefined
    };

    event.waitUntil(
        Promise.all([
            self.registration.showNotification(title, options),
            self.clients.matchAll({ type: 'window' }).then(function (clients) {
                clients.forEach(function (client) { client.postMessage({ type: 'PUSH_RECEIVED' }); });
            })
        ])
    );
});

// ---------- NOTIFICATION CLICK: focus an open tab, or open a new one ----------
self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clients) {
            for (let i = 0; i < clients.length; i++) {
                if ('focus' in clients[i]) return clients[i].focus();
            }
            if (self.clients.openWindow) return self.clients.openWindow(event.notification.data || '/');
        })
    );
});

// ---------- SUBSCRIPTION RENEWAL: browsers occasionally rotate the
// push subscription on their own; re-subscribe and tell the page to
// save the new one in Supabase ----------
self.addEventListener('pushsubscriptionchange', function (event) {
    event.waitUntil(
        self.registration.pushManager.subscribe(event.oldSubscription ? event.oldSubscription.options : { userVisibleOnly: true })
            .then(function (subscription) {
                return self.clients.matchAll({ type: 'window' }).then(function (clients) {
                    clients.forEach(function (client) {
                        client.postMessage({ type: 'PUSH_SUBSCRIPTION_RENEWED', subscription: subscription });
                    });
                });
            })
            .catch(function () {})
    );
});
