if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('PWA: falha ao registrar o service worker', e); });
  });
}
