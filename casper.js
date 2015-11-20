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
  console.log(self);

  ['install', 'activate', 'beforeevicted', 'evicted', 'message', 'push'].forEach((event) => {
    self.addEventListener(event, (e) => {
      console.log(event, e);
    });
  });

  self.addEventListener('fetch', (e) => {
    let req = e.request.clone();
    console.debug(payload(req));

    fetch(req).then((res) => {
      console.debug(payload(res));
    });
  });

  self.addEventListener('install', (e) => {
    e.waitUntil(self.skipWaiting());
  });

  self.addEventListener('activate', (e) => {
    e.waitUntil(self.clients.claim());
    console.log('claimed');
  });
}

if (typeof window !== 'undefined') {
  (() => {
    if (!('serviceWorker' in navigator)) {
      console.error('service worker not supported');
      return;
    }

    navigator.serviceWorker.getRegistration().then((worker) => {
      console.log('getRegistration:', worker);

      if (worker === undefined) return;
      worker.addEventListener('updatefound', (e) => {
        console.log('updatefound', e);
      });
    }).catch(console.error.bind(console));

    navigator.serviceWorker.register('casper.js', { scope: '.' }).then((worker) => {
      console.log('register success:', worker);

      // return navigator.serviceWorker.ready;
      return new Promise((resolve) => {
        // controllerchange after claimed
        navigator.serviceWorker.addEventListener('controllerchange', resolve);
      });
    }).then(() => {
      console.log('controlled?', navigator.serviceWorker.controller);
    }).catch(console.error.bind(console));
  })();
}
