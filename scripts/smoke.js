#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const assert = require('assert');
const { LocalServer } = require('../desktop/local-server');
const baseConfig = require('../js/config-base.js');

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = addr && addr.port;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  assert(html.includes('js/config-base.js'), 'index.html must load js/config-base.js');
  assert(html.includes('window.BTCT_CONFIG_READY'), 'index.html must wait for BTCT_CONFIG_READY before App.start');
  assert(baseConfig && baseConfig.btc && baseConfig.weather && baseConfig.pc, 'config-base must expose btc/weather/pc defaults');

  const httpPort = await getFreePort();
  const httpsPort = await getFreePort();
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'btct-smoke-'));

  const server = new LocalServer({
    rootDir: projectRoot,
    userDataPath,
    getRuntimeConfig: () => baseConfig,
    getDesktopConfig: () => ({
      pc: { endpoint: 'http://127.0.0.1:9/data.json' },
      network: { httpPort, httpsPort, preferHttps: false }
    })
  });

  try {
    await server.start({ network: { httpPort, httpsPort } });
    const health = await fetch(`http://127.0.0.1:${httpPort}/health`, { cache: 'no-store' }).then((r) => r.json());
    assert(health && health.ok === true, '/health should return ok');
    assert(typeof health.uptimeMs === 'number', '/health should include uptimeMs');
    assert(health.metrics && health.metrics.api && health.metrics.api.pc, '/health should include API metrics');

    const runtime = await fetch(`http://127.0.0.1:${httpPort}/btct-runtime-config.json`, { cache: 'no-store' }).then((r) => r.json());
    assert(runtime && runtime.btc && runtime.weather, '/btct-runtime-config.json should return runtime config');

    console.log('smoke: ok');
  } finally {
    await server.stop();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('smoke: failed');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
