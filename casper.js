'use strict';

function payload(r) {
  let firstLine = (r) => {
    if (r instanceof Request) {
      return `${r.method} ${r.url} HTTP/1.1`;
    }
    if (r instanceof Response) {
      return `HTTP/1.1 ${r.status} ${r.statusText}`;
    }
  }
  let headerLine = (headers) => {
    return Array.from(headers.entries())
    .map((e) => {
      if (e[0] === 'user-agent') {
        e[1] = e[1].substr(0, 6);
      }
      return e.join(': ');
    }).join('\n');
  };
  return `
${firstLine(r)}
${headerLine(r.headers)}
`;
}

if ('ServiceWorkerGlobalScope' in self && self instanceof ServiceWorkerGlobalScope) {
  importScripts('golombset.js');
  importScripts('base64url.js');

  (() => {
    const CACHE_KEY = 'casper-v1';

    ['install', 'activate', 'beforeevicted', 'evicted', 'message', 'push'].forEach((event) => {
      self.addEventListener(event, (e) => {
        console.log(event, e);
      });
    });

    self.addEventListener('fetch', (e) => {
      let req = e.request.clone();
      console.debug(payload(req));

      e.respondWith(
        caches.open(CACHE_KEY).then((cache) => {
          return cache.match(req).then((res) => {
            if (res) {
              // cache hit
              console.info(payload(res));
              return res;
            }

            // calclate cache-fingerprint
            return cache.keys().then((requests) => {
              return Promise.all(requests.map((req) => cache.match(req))).then((responses) => {
                // collect & sort finger-print-key
                let fingerprints = responses.map((res) => res.headers.get('cache-fingerprint-key')).sort;

                // encode golombset
                let golombset = new Golombset(256);
                golombset.encode(fingerprints);

                // encode base64url
                let base64 = base64url_encode(golombset.buf);

                // add cache-fingerprint
                let init = {
                  headers: new Headers({ 'Cache-Fingeprint': base64 }),
                };
                let req = new Request(e.request, init);
                console.log(req);
                console.log(payload(req));

                // fetch
                return fetch(req).then((res) => {
                  console.debug(payload(res));

                  // add to cache
                  cache.put(req, res.clone());
                  return res;
                });
              });
            });
          })
        })
      );
    });
  })();
}

if (typeof window !== 'undefined') {
  (() => {
    if (!('serviceWorker' in navigator)) {
      console.error('service worker not supported');
      return;
    }

    navigator.serviceWorker.getRegistration().then((worker) => {
      console.log('getRegistration', worker);

      if (worker) return worker;

      return navigator.serviceWorker.register('casper.js', { scope: '.' });
    }).then((worker) => {
      console.log('register success:', worker);
      return navigator.serviceWorker.ready;
    }).then(() => {
      console.log('controlled?', navigator.serviceWorker.controller);
    }).catch(console.error.bind(console));
  })();
}
