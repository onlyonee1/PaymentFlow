'use strict';

const SHELL = 'paymentflow-parent-shell-v1';
const RECEIPTS = 'paymentflow-parent-receipts-v1';
const RECEIPT_KEY = '/parent-pay/offline-receipts';
const ASSETS = [
  '/pay',
  '/parent-pay/portal.css',
  '/parent-pay/portal.js',
  '/parent-pay/manifest.webmanifest',
  '/parent-pay/icon-192.png',
  '/parent-pay/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('paymentflow-parent-shell-') && key !== SHELL).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !ASSETS.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    return await cache.match(url.pathname) || fetch(request);
  })());
});

let pending = Promise.resolve();

self.addEventListener('message', (event) => {
  if (!event.ports[0] || !event.source?.url || new URL(event.source.url).pathname !== '/pay') return;
  const { type, receipt } = event.data || {};
  if (!['list', 'save', 'clear'].includes(type)) return;
  const reply = event.ports[0];
  pending = pending.catch(() => {}).then(async () => {
    const cache = await caches.open(RECEIPTS);
    const stored = await cache.match(RECEIPT_KEY);
    let receipts = stored ? await stored.json() : [];
    if (type === 'clear') {
      await cache.delete(RECEIPT_KEY);
      receipts = [];
    } else if (type === 'save') {
      if (
        !receipt || !/^[a-f0-9]{64}$/i.test(receipt.txHash) ||
        !Number.isFinite(receipt.amount) || typeof receipt.currency !== 'string' ||
        typeof receipt.schoolName !== 'string'
      ) throw new Error('Invalid receipt');
      const { txHash, amount, currency, schoolName, confirmedAt } = receipt;
      receipts = [{ txHash, amount, currency, schoolName, confirmedAt }, ...receipts.filter(item => item.txHash !== txHash)].slice(0, 5);
      await cache.put(RECEIPT_KEY, new Response(JSON.stringify(receipts), { headers: { 'Content-Type': 'application/json' } }));
    }
    reply.postMessage({ receipts });
  });
  event.waitUntil(pending.catch(() => reply.postMessage({ error: 'Could not open offline receipts.' })));
});
