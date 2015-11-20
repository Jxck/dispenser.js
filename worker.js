'use strict';
if ('ServiceWorkerGlobalScope' in self && self instanceof ServiceWorkerGlobalScope) {
  self.addEventListener('fetch', (e) => {
    let init = {
      headers: new Headers({'X-Own-Header': '123'}),
    };
    let req = new Request(e.request, init);
    console.log(req);
    console.log(Array.from(req.headers.entries()));

    e.respondWith(fetch(req));
  });
}

if (typeof window !== 'undefined') {
  navigator.serviceWorker.register('worker.js', { scope: '.' }).then((worker) => {
    return navigator.serviceWorker.ready;
  }).then(() => {
    console.log('controlled?', navigator.serviceWorker.controller);
  }).catch(console.error.bind(console));
}
