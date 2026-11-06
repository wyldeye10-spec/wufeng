#!/usr/bin/env node
/**
 * 构建后生成 sw.js：把 dist 中的全部产物作为应用外壳预缓存，支持首次加载后完全离线。
 * Cache 版本由全部文件的路径与内容哈希决定，部署新版本后会自动换缓存。
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const dist = path.resolve('dist')

async function walk(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(path.join(dir, entry.name), relative)))
    } else if (entry.isFile()) {
      files.push(relative)
    }
  }
  return files
}

const all = (await walk(dist)).sort()
const files = all.filter((file) => file !== 'sw.js' && !file.endsWith('.map'))
if (!files.includes('index.html')) {
  throw new Error('dist/index.html 不存在，无法生成 Service Worker')
}

const hash = createHash('sha256')
for (const file of files) {
  hash.update(file)
  hash.update(await readFile(path.join(dist, file)))
}
const version = hash.digest('hex').slice(0, 12)

const precache = files.map((file) => `./${file}`)

const sw = `/* 无锋 · 离线卷宗 · 由 scripts/generate-sw.mjs 生成，请勿手改 */
const VERSION = '${version}';
const CACHE = 'wufeng-' + VERSION;
const PRECACHE = ${JSON.stringify(precache, null, 2)};
const SHELL = new URL('./index.html', self.registration.scope).href;

const absolute = (url) => new URL(url, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE.map(absolute));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key.startsWith('wufeng-') && key !== CACHE).map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

function isNavigation(request) {
  return request.mode === 'navigate' ||
    (request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html'));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isNavigation(request)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2600);
      try {
        const response = await fetch(request, { signal: controller.signal });
        clearTimeout(timer);
        if (response && response.ok) {
          await cache.put(SHELL, response.clone());
        }
        return response;
      } catch (error) {
        clearTimeout(timer);
        // 静态托管常带 Vary: Origin；离线重载的模块请求可能没有同一个 Origin，
        // 必须忽略 Vary 才能命中预缓存。
        const cached = await cache.match(SHELL, { ignoreVary: true });
        if (cached) return cached;
        return new Response('无锋 · 离线卷宗尚未缓存，请联网后再试。', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreVary: true, ignoreSearch: true });
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch (error) {
      return Response.error();
    }
  })());
});
`

await writeFile(path.join(dist, 'sw.js'), sw, 'utf8')
console.log(`sw.js generated · cache wufeng-${version} · ${files.length} precached files`)
