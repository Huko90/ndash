const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const os = require('os');
const selfsigned = require('selfsigned');
const { URL } = require('url');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.crt': 'application/x-x509-ca-cert',
  '.txt': 'text/plain; charset=utf-8'
};

function localIpv4List() {
  const ifaces = os.networkInterfaces();
  const out = [];
  Object.values(ifaces).forEach((arr) => {
    (arr || []).forEach((i) => {
      if (i && i.family === 'IPv4' && !i.internal) out.push(i.address);
    });
  });
  return out;
}

function ensureCert(certDir) {
  const certPath = path.join(certDir, 'local-dashboard.crt');
  const keyPath = path.join(certDir, 'local-dashboard.key');
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return {
      certPath,
      keyPath,
      cert: fs.readFileSync(certPath, 'utf8'),
      key: fs.readFileSync(keyPath, 'utf8')
    };
  }
  fs.mkdirSync(certDir, { recursive: true });
  const ips = localIpv4List();
  const altNames = [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }];
  ips.forEach((ip) => altNames.push({ type: 7, ip: ip }));
  const attrs = [{ name: 'commonName', value: 'ndash.local' }];
  const pems = selfsigned.generate(attrs, {
    days: 3650,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: altNames }]
  });
  fs.writeFileSync(certPath, pems.cert);
  fs.writeFileSync(keyPath, pems.private);
  return {
    certPath,
    keyPath,
    cert: pems.cert,
    key: pems.private
  };
}

class LocalServer {
  constructor(options) {
    this.rootDir = options.rootDir;
    this.userDataPath = options.userDataPath;
    this.getRuntimeConfig = options.getRuntimeConfig;
    this.getDesktopConfig = options.getDesktopConfig;
    this.updateDesktopConfig = options.updateDesktopConfig;
    this.httpServer = null;
    this.httpsServer = null;
    this.state = null;
    this.startedAt = null;
    this.metrics = {
      requests: 0,
      api: {
        pc: { ok: 0, error: 0, lastError: '', lastOkAt: 0, lastErrAt: 0 },
        stocks: { ok: 0, error: 0, lastError: '', lastOkAt: 0, lastErrAt: 0 }
      }
    };
    this.rateLimit = new Map();
  }

  isRateLimited(req, bucketName) {
    const now = Date.now();
    const key = `${bucketName}:${(req.socket && req.socket.remoteAddress) || 'unknown'}`;
    const windowMs = 60 * 1000;
    const maxPerWindow = 120;
    const arr = this.rateLimit.get(key) || [];
    const next = arr.filter((ts) => now - ts < windowMs);
    next.push(now);
    this.rateLimit.set(key, next);
    return next.length > maxPerWindow;
  }

  markApiResult(name, ok, err) {
    const group = this.metrics.api[name];
    if (!group) return;
    if (ok) {
      group.ok += 1;
      group.lastOkAt = Date.now();
      return;
    }
    group.error += 1;
    group.lastErrAt = Date.now();
    group.lastError = err && err.message ? err.message : String(err || 'unknown_error');
  }

  async handleRequest(req, res) {
    this.metrics.requests += 1;
    const reqUrl = new URL(req.url || '/', 'http://localhost');
    const urlPath = decodeURIComponent(reqUrl.pathname || '/');

    if (urlPath === '/health') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        ts: Date.now(),
        uptimeMs: this.startedAt ? (Date.now() - this.startedAt) : 0,
        urls: this.state ? { http: this.state.httpUrl, https: this.state.httpsUrl } : null,
        metrics: this.metrics
      }));
      return;
    }

    if (urlPath === '/btct-runtime-config.json') {
      const cfg = this.getRuntimeConfig();
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(cfg));
      return;
    }

    if (urlPath === '/api/pc') {
      if (this.isRateLimited(req, 'pc')) {
        this.markApiResult('pc', false, new Error('rate_limited'));
        res.writeHead(429, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: 'rate_limited' }));
        return;
      }
      const desktopCfg = this.getDesktopConfig ? this.getDesktopConfig() : null;
      const endpoint = desktopCfg && desktopCfg.pc ? String(desktopCfg.pc.endpoint || '').trim() : '';
      if (!/^https?:\/\//i.test(endpoint)) {
        this.markApiResult('pc', false, new Error('invalid_pc_endpoint'));
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid PC endpoint URL in desktop config.' }));
        return;
      }
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 7000);
        const upstream = await fetch(endpoint, { cache: 'no-store', signal: ctrl.signal });
        clearTimeout(t);
        if (!upstream.ok) {
          this.markApiResult('pc', false, new Error(`upstream_http_${upstream.status}`));
          res.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          res.end(JSON.stringify({ ok: false, error: `Upstream returned HTTP ${upstream.status}.` }));
          return;
        }
        const body = await upstream.text();
        this.markApiResult('pc', true);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(body);
      } catch (err) {
        this.markApiResult('pc', false, err);
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: err && err.message ? err.message : 'PC endpoint request failed.' }));
      }
      return;
    }

    if (urlPath.startsWith('/api/stocks/')) {
      if (this.isRateLimited(req, 'stocks')) {
        this.markApiResult('stocks', false, new Error('rate_limited'));
        res.writeHead(429, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: 'stocks_rate_limited' }));
        return;
      }
      const allowQueryKey = process.env.BTCT_ALLOW_STOCKS_KEY_QUERY === '1';
      const requestKey = allowQueryKey ? String(reqUrl.searchParams.get('apiKey') || '').trim() : '';
      const stocksKey = String(process.env.BTCT_STOCKS_API_KEY || '').trim() || requestKey;
      if (!stocksKey) {
        this.markApiResult('stocks', false, new Error('stocks_api_key_missing'));
        res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: 'stocks_api_key_missing', detail: 'Set BTCT_STOCKS_API_KEY for desktop server.' }));
        return;
      }
      const endpoint = urlPath.replace('/api/stocks', '');
      const upstreamBase = String(process.env.BTCT_STOCKS_API_BASE || 'https://api.polygon.io').replace(/\/$/, '');
      const send = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(payload));
      };
      const tfToDays = (mult, span, limit) => {
        const units = span === 'minute' ? (mult * limit / (60 * 24)) : span === 'hour' ? (mult * limit / 24) : (mult * limit);
        return Math.max(2, Math.ceil(units) + 2);
      };
      const recentDailyAggs = async (ticker, daysBack, limit) => {
        const now = new Date();
        const from = new Date(now.getTime() - Math.max(3, daysBack || 7) * 24 * 60 * 60 * 1000);
        const fromStr = from.toISOString().slice(0, 10);
        const toStr = now.toISOString().slice(0, 10);
        const upstream = await fetch(
          `${upstreamBase}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${fromStr}/${toStr}?${qs({ adjusted: 'true', sort: 'asc', limit: limit || 10 })}`,
          { cache: 'no-store' }
        );
        const raw = await upstream.json();
        return Array.isArray(raw && raw.results) ? raw.results : [];
      };
      const qs = (obj) => {
        const sp = new URLSearchParams();
        Object.keys(obj || {}).forEach((k) => {
          if (obj[k] === undefined || obj[k] === null || obj[k] === '') return;
          sp.set(k, String(obj[k]));
        });
        sp.set('apiKey', stocksKey);
        return sp.toString();
      };
      try {
        if (endpoint === '/marketstatus') {
          const upstream = await fetch(`${upstreamBase}/v1/marketstatus/now?${qs({})}`, { cache: 'no-store' });
          const raw = await upstream.json();
          const market = String((raw && raw.market) || '').toLowerCase() === 'open' ? 'open' : 'closed';
          this.markApiResult('stocks', true);
          send(200, { ok: true, market, raw });
          return;
        }
        if (endpoint === '/snapshot') {
          const ticker = String(reqUrl.searchParams.get('ticker') || 'AAPL').trim().toUpperCase();
          if (!/^[A-Z0-9]{1,12}$/.test(ticker)) {
            this.markApiResult('stocks', false, new Error('invalid_ticker'));
            send(400, { ok: false, error: 'invalid_ticker', detail: ticker });
            return;
          }
          const daily = await recentDailyAggs(ticker, 10, 10);
          if (!daily.length) {
            send(200, { ok: true, ticker, snapshot: { day: {}, prevDay: {} } });
            return;
          }
          const dayBar = daily[daily.length - 1] || {};
          const prevBar = daily.length > 1 ? daily[daily.length - 2] : dayBar;
          this.markApiResult('stocks', true);
          send(200, {
            ok: true,
            ticker,
            snapshot: {
              day: { o: dayBar.o, h: dayBar.h, l: dayBar.l, c: dayBar.c, v: dayBar.v },
              prevDay: { c: prevBar.c }
            }
          });
          return;
        }
        if (endpoint === '/aggs') {
          const ticker = String(reqUrl.searchParams.get('ticker') || 'AAPL').trim().toUpperCase();
          let mult = Number(reqUrl.searchParams.get('mult') || 1);
          const span = String(reqUrl.searchParams.get('span') || 'minute').trim().toLowerCase();
          let limit = Number(reqUrl.searchParams.get('limit') || 500);
          if (!/^[A-Z0-9]{1,12}$/.test(ticker)) {
            this.markApiResult('stocks', false, new Error('invalid_ticker'));
            send(400, { ok: false, error: 'invalid_ticker', detail: ticker });
            return;
          }
          if (!['minute', 'hour', 'day'].includes(span)) {
            this.markApiResult('stocks', false, new Error('invalid_timespan'));
            send(400, { ok: false, error: 'invalid_timespan', detail: span });
            return;
          }
          mult = Math.max(1, Math.min(60, Number.isFinite(mult) ? Math.floor(mult) : 1));
          limit = Math.max(50, Math.min(5000, Number.isFinite(limit) ? Math.floor(limit) : 500));
          const now = new Date();
          const from = new Date(now.getTime() - tfToDays(mult, span, limit) * 24 * 60 * 60 * 1000);
          const fromStr = from.toISOString().slice(0, 10);
          const toStr = now.toISOString().slice(0, 10);
          const upstream = await fetch(
            `${upstreamBase}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${mult}/${span}/${fromStr}/${toStr}?${qs({ adjusted: 'true', sort: 'asc', limit })}`,
            { cache: 'no-store' }
          );
          const raw = await upstream.json();
          this.markApiResult('stocks', true);
          send(200, { ok: true, ticker, results: Array.isArray(raw && raw.results) ? raw.results : [] });
          return;
        }
        if (endpoint === '/heatmap') {
          const inTickers = String(reqUrl.searchParams.get('tickers') || '').split(',').map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z0-9]{1,12}$/.test(t)).slice(0, 20);
          const tickers = inTickers.length ? inTickers : ['AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA','AMD','NFLX','PLTR'];
          const items = [];
          await Promise.all(tickers.map(async (ticker) => {
            try {
              const daily = await recentDailyAggs(ticker, 10, 10);
              if (!daily.length) return;
              const dayBar = daily[daily.length - 1] || {};
              const prevBar = daily.length > 1 ? daily[daily.length - 2] : dayBar;
              const last = Number(dayBar.c || 0);
              const prevClose = Number(prevBar.c || 0);
              const changePct = prevClose ? ((last - prevClose) / prevClose * 100) : 0;
              items.push({ ticker, changePct, price: last });
            } catch (_err) {}
          }));
          this.markApiResult('stocks', true);
          send(200, { ok: true, items });
          return;
        }
        this.markApiResult('stocks', false, new Error('unknown_stocks_endpoint'));
        send(404, { ok: false, error: 'unknown_stocks_endpoint', detail: endpoint });
      } catch (err) {
        this.markApiResult('stocks', false, err);
        send(502, { ok: false, error: 'stocks_upstream_error', detail: err && err.message ? err.message : 'upstream request failed' });
      }
      return;
    }

    if (urlPath === '/dashboard-cert.crt') {
      if (!this.state || !this.state.certPath || !fs.existsSync(this.state.certPath)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('certificate not found');
        return;
      }
      res.writeHead(200, { 'content-type': MIME['.crt'], 'cache-control': 'no-store' });
      res.end(fs.readFileSync(this.state.certPath));
      return;
    }

    // Wallpaper upload/delete API
    if (urlPath === '/api/wallpapers' && (req.method === 'POST' || req.method === 'DELETE')) {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const dashboard = String(body && body.dashboard || '');
          if (!['btc', 'weather', 'pc'].includes(dashboard)) {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: 'Invalid dashboard' }));
            return;
          }
          const wpDir = path.join(this.userDataPath, 'wallpapers');
          const getCfg = this.getDesktopConfig;
          const updateCfg = this.updateDesktopConfig;

          if (req.method === 'DELETE') {
            const cfg = getCfg ? getCfg() : {};
            const filename = cfg.wallpapers && cfg.wallpapers[dashboard];
            if (filename) try { fs.unlinkSync(path.join(wpDir, filename)); } catch (_) {}
            if (updateCfg) {
              const wallpapers = Object.assign({}, cfg.wallpapers || {});
              delete wallpapers[dashboard];
              updateCfg({ wallpapers });
            }
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          // POST — save wallpaper
          const match = String(body.dataUrl || '').match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
          if (!match) {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: 'Invalid image data' }));
            return;
          }
          const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
          const buffer = Buffer.from(match[2], 'base64');
          if (buffer.length > 5 * 1024 * 1024) {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: 'Image too large (max 5 MB)' }));
            return;
          }
          fs.mkdirSync(wpDir, { recursive: true });
          const cfg = getCfg ? getCfg() : {};
          const oldFile = cfg.wallpapers && cfg.wallpapers[dashboard];
          if (oldFile) try { fs.unlinkSync(path.join(wpDir, oldFile)); } catch (_) {}

          const filename = dashboard + '.' + ext;
          fs.writeFileSync(path.join(wpDir, filename), buffer);
          if (updateCfg) {
            const wallpapers = Object.assign({}, cfg.wallpapers || {});
            wallpapers[dashboard] = filename;
            updateCfg({ wallpapers });
          }
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, url: '/wallpapers/' + filename }));
        } catch (err) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid request' }));
        }
      });
      return;
    }

    if (urlPath.startsWith('/wallpapers/')) {
      const wpName = path.basename(urlPath);
      if (!/^\w+\.(jpg|jpeg|png|webp)$/i.test(wpName)) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('invalid filename');
        return;
      }
      const wpPath = path.join(this.userDataPath, 'wallpapers', wpName);
      fs.stat(wpPath, (err, stat) => {
        if (err || !stat.isFile()) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('not found');
          return;
        }
        const ext = path.extname(wpPath).toLowerCase();
        res.writeHead(200, {
          'content-type': MIME[ext] || 'application/octet-stream',
          'cache-control': 'no-store'
        });
        fs.createReadStream(wpPath).pipe(res);
      });
      return;
    }

    const safePath = path.normalize(urlPath).replace(/^\.+/, '');
    let filePath = path.join(this.rootDir, safePath);
    if (urlPath === '/' || urlPath === '') filePath = path.join(this.rootDir, 'index.html');

    if (!filePath.startsWith(this.rootDir)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('forbidden');
      return;
    }

    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=300'
      });
      fs.createReadStream(filePath).pipe(res);
    });
  }

  async start(config) {
    await this.stop();
    this.startedAt = Date.now();
    this.metrics = {
      requests: 0,
      api: {
        pc: { ok: 0, error: 0, lastError: '', lastOkAt: 0, lastErrAt: 0 },
        stocks: { ok: 0, error: 0, lastError: '', lastOkAt: 0, lastErrAt: 0 }
      }
    };
    const certInfo = ensureCert(path.join(this.userDataPath, 'certs'));

    const requestHandler = this.handleRequest.bind(this);
    this.httpServer = http.createServer(requestHandler);
    this.httpsServer = https.createServer({ key: certInfo.key, cert: certInfo.cert }, requestHandler);

    const httpPort = config.network.httpPort;
    const httpsPort = config.network.httpsPort;

    try {
      await new Promise((resolve, reject) => {
        this.httpServer.once('error', reject);
        this.httpServer.listen(httpPort, '0.0.0.0', resolve);
      });

      await new Promise((resolve, reject) => {
        this.httpsServer.once('error', reject);
        this.httpsServer.listen(httpsPort, '0.0.0.0', resolve);
      });
    } catch (err) {
      await this.stop();
      throw err;
    }

    const ips = localIpv4List();
    const primaryIp = ips[0] || '127.0.0.1';

    this.state = {
      ips,
      primaryIp,
      httpPort,
      httpsPort,
      certPath: certInfo.certPath,
      httpUrl: `http://${primaryIp}:${httpPort}`,
      httpsUrl: `https://${primaryIp}:${httpsPort}`
    };

    return this.state;
  }

  async stop() {
    const closeServer = (srv) => new Promise((resolve) => {
      if (!srv) return resolve();
      srv.close(() => resolve());
    });
    await closeServer(this.httpServer);
    await closeServer(this.httpsServer);
    this.httpServer = null;
    this.httpsServer = null;
  }

  getState() {
    return this.state;
  }
}

module.exports = { LocalServer, localIpv4List, ensureCert };
