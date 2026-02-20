// Initialisation — extracted from inline scripts for CSP compliance.
// Font preload → stylesheet conversion
var fontLinks = document.querySelectorAll('link[rel="preload"][as="style"]');
fontLinks.forEach(function(link) { link.rel = 'stylesheet'; });

// App startup (waits for optional runtime config)
(window.BTCT_CONFIG_READY || Promise.resolve())
    .catch(function(){})
    .then(function(){ App.start('btc'); });

// Service Worker registration (skip in Electron)
if ('serviceWorker' in navigator && !window.DesktopApi) {
    navigator.serviceWorker.register('/sw.js').catch(function() {});
}
