'use strict';

function payload(req) {
  return `${req.method} ${req.url}` + '\n' +
          Array.from(req.headers.entries())
               .map((e) => {
                 if (e[0] === 'user-agent') {
                   e[1] = e[1].substr(0, 6);
                 }
                 return e.join(': ');
               }).join('\n');
}

if ('ServiceWorkerGlobalScope' in self && self instanceof ServiceWorkerGlobalScope) {
  console.log(self);

  ['install', 'activate', 'beforeevicted', 'evicted', 'message', 'push'].forEach((e) => {
    self.addEventListener(e, (ev) => {
      console.log(e, ev);
    });
  });

  self.addEventListener('fetch', (ev) => {
    let req = ev.request;
    console.log('fetch', req.method, req.url, req);
    console.info(payload(req));
  });

  self.addEventListener('install', (ev) => {
    ev.waitUntil(self.skipWaiting());
  });

  self.addEventListener('activate', (ev) => {
    ev.waitUntil(self.clients.claim());
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
      worker.addEventListener('updatefound', (ev) => {
        console.log('updatefound', ev);
      });
    }).catch(console.error.bind(console));

    navigator.serviceWorker.register('casper.js',  {scope: '.'}).then((worker) => {
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
