// -----bookReader.js-----
import AppController from './appController.js';

(() => {
  if (window.__bookAppBootstrapped) {
    console.warn('🔁 App already bootstrapped; skipping.');
    return;
  }
  window.__bookAppBootstrapped = true;

  (async () => {
    try {
      const app = new AppController();
      await app.bootstrap();
      window.app = app;
    } catch (err) {
      console.error('Book init failed:', err);
    }
  })();
})();
