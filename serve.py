#!/usr/bin/env python3
"""Simple HTTP server for BTC Ticker Kiosk"""
import http.server
import socketserver
import os
import json
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from urllib.parse import urlparse, parse_qs, urlencode, quote

PORT = 8888
DIRECTORY = "/home/niko/btctracker"
PC_ENDPOINT = os.environ.get("BTCT_PC_ENDPOINT", "http://192.168.0.118:8085/data.json")
STOCKS_API_KEY = os.environ.get("BTCT_STOCKS_API_KEY", "").strip()
STOCKS_API_BASE = os.environ.get("BTCT_STOCKS_API_BASE", "https://api.polygon.io").rstrip("/")
ALLOW_STOCKS_QUERY_KEY = os.environ.get("BTCT_ALLOW_STOCKS_KEY_QUERY", "0") == "1"
SERVER_STARTED_AT = datetime.now(timezone.utc)
STOCKS_CACHE = {
    "marketstatus": {"ts": 0, "data": None},
    "daily": {}
}
METRICS = {
    "requests": 0,
    "api": {
        "pc": {"ok": 0, "error": 0, "lastError": "", "lastOkAt": 0, "lastErrAt": 0},
        "stocks": {"ok": 0, "error": 0, "lastError": "", "lastOkAt": 0, "lastErrAt": 0}
    }
}

os.chdir(DIRECTORY)

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        METRICS["requests"] += 1
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            now = datetime.now(timezone.utc)
            uptime_ms = int((now - SERVER_STARTED_AT).total_seconds() * 1000)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(json.dumps({
                "ok": True,
                "ts": int(now.timestamp() * 1000),
                "uptimeMs": uptime_ms,
                "metrics": METRICS
            }).encode("utf-8"))
            return
        if parsed.path == "/api/pc":
            self._handle_pc_proxy()
            return
        if parsed.path.startswith("/api/stocks/"):
            self._handle_stocks_proxy(parsed.path, parse_qs(parsed.query or ""))
            return
        super().do_GET()

    def _handle_pc_proxy(self):
        req = Request(PC_ENDPOINT, headers={"User-Agent": "btcticker-proxy/1.0"})
        try:
            with urlopen(req, timeout=5) as upstream:
                payload = upstream.read()
                status = upstream.getcode() or 200
        except (HTTPError, URLError, TimeoutError, ValueError) as exc:
            self._mark_api("pc", False, exc)
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            error = {"error": "pc_endpoint_unreachable", "detail": str(exc)}
            self.wfile.write(json.dumps(error).encode("utf-8"))
            return

        self._mark_api("pc", True)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def _json_error(self, status, error, detail=""):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": False, "error": error, "detail": detail}).encode("utf-8"))

    def _mark_api(self, name, ok, err=None):
        bucket = METRICS.get("api", {}).get(name)
        if not bucket:
            return
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        if ok:
            bucket["ok"] += 1
            bucket["lastOkAt"] = now_ms
            return
        bucket["error"] += 1
        bucket["lastErrAt"] = now_ms
        bucket["lastError"] = str(err or "unknown_error")

    def _stocks_fetch_json(self, path, api_key, params=None, timeout=8):
        params = dict(params or {})
        params["apiKey"] = api_key
        url = f"{STOCKS_API_BASE}{path}?{urlencode(params)}"
        req = Request(url, headers={"User-Agent": "btcticker-stocks-proxy/1.0"})
        with urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _now_ts(self):
        return datetime.now(timezone.utc).timestamp()

    def _cache_get_daily(self, ticker, ttl_s):
        ent = STOCKS_CACHE["daily"].get(ticker)
        if not ent:
            return None
        if self._now_ts() - ent.get("ts", 0) > ttl_s:
            return None
        return ent.get("data")

    def _cache_set_daily(self, ticker, data):
        STOCKS_CACHE["daily"][ticker] = {"ts": self._now_ts(), "data": data}

    def _tf_to_delta(self, mult, span, limit):
        if span == "minute":
            return timedelta(minutes=mult * limit)
        if span == "hour":
            return timedelta(hours=mult * limit)
        return timedelta(days=mult * limit)

    def _recent_daily_aggs(self, ticker, api_key, days_back=7, limit=10):
        cached = self._cache_get_daily(ticker, 90)
        if cached is not None:
            return cached
        to_dt = datetime.now(timezone.utc)
        from_dt = to_dt - timedelta(days=max(3, days_back))
        from_str = from_dt.strftime("%Y-%m-%d")
        to_str = to_dt.strftime("%Y-%m-%d")
        raw = self._stocks_fetch_json(
            f"/v2/aggs/ticker/{quote(ticker)}/range/1/day/{from_str}/{to_str}",
            api_key,
            {"adjusted": "true", "sort": "asc", "limit": str(limit)}
        )
        results = (raw or {}).get("results", []) or []
        self._cache_set_daily(ticker, results)
        return results

    def _handle_stocks_proxy(self, path, query):
        req_key = str((query.get("apiKey") or [""])[0] or "").strip() if ALLOW_STOCKS_QUERY_KEY else ""
        api_key = req_key or STOCKS_API_KEY
        if not api_key:
            self._mark_api("stocks", False, "stocks_api_key_missing")
            self._json_error(503, "stocks_api_key_missing", "Set BTCT_STOCKS_API_KEY on the server.")
            return

        endpoint = path.replace("/api/stocks", "", 1)
        try:
            if endpoint == "/marketstatus":
                cache_ent = STOCKS_CACHE.get("marketstatus", {})
                cache_data = cache_ent.get("data")
                cache_ts = cache_ent.get("ts", 0)
                if cache_data and self._now_ts() - cache_ts <= 20:
                    raw = cache_data
                else:
                    raw = self._stocks_fetch_json("/v1/marketstatus/now", api_key)
                    STOCKS_CACHE["marketstatus"] = {"ts": self._now_ts(), "data": raw}
                market = str((raw or {}).get("market", "")).strip().lower()
                payload = {"ok": True, "market": "open" if market == "open" else "closed", "raw": raw}
            elif endpoint == "/snapshot":
                ticker = str((query.get("ticker") or ["AAPL"])[0]).strip().upper()
                if not ticker.isalnum():
                    self._json_error(400, "invalid_ticker", ticker)
                    return
                daily = self._recent_daily_aggs(ticker, api_key, days_back=10, limit=10)
                if not daily:
                    payload = {"ok": True, "snapshot": {"day": {}, "prevDay": {}}, "ticker": ticker}
                else:
                    day_bar = daily[-1]
                    prev_bar = daily[-2] if len(daily) > 1 else daily[-1]
                    payload = {
                        "ok": True,
                        "ticker": ticker,
                        "snapshot": {
                            "day": {"o": day_bar.get("o"), "h": day_bar.get("h"), "l": day_bar.get("l"), "c": day_bar.get("c"), "v": day_bar.get("v")},
                            "prevDay": {"c": prev_bar.get("c")}
                        }
                    }
            elif endpoint == "/aggs":
                ticker = str((query.get("ticker") or ["AAPL"])[0]).strip().upper()
                mult = int((query.get("mult") or ["1"])[0] or 1)
                span = str((query.get("span") or ["minute"])[0] or "minute").strip().lower()
                limit = int((query.get("limit") or ["500"])[0] or 500)
                if span not in ("minute", "hour", "day"):
                    self._json_error(400, "invalid_timespan", span)
                    return
                if not ticker.isalnum():
                    self._json_error(400, "invalid_ticker", ticker)
                    return
                mult = max(1, min(mult, 60))
                limit = max(50, min(limit, 5000))
                to_dt = datetime.now(timezone.utc)
                from_dt = to_dt - self._tf_to_delta(mult, span, limit + 30)
                from_str = from_dt.strftime("%Y-%m-%d")
                to_str = to_dt.strftime("%Y-%m-%d")
                raw = self._stocks_fetch_json(
                    f"/v2/aggs/ticker/{quote(ticker)}/range/{mult}/{span}/{from_str}/{to_str}",
                    api_key,
                    {"adjusted": "true", "sort": "asc", "limit": str(limit)}
                )
                payload = {"ok": True, "results": (raw or {}).get("results", []), "ticker": ticker}
            elif endpoint == "/heatmap":
                tickers_raw = str((query.get("tickers") or [""])[0] or "")
                tickers = [t.strip().upper() for t in tickers_raw.split(",") if t.strip()]
                tickers = [t for t in tickers if t.isalnum()][:20]
                if not tickers:
                    tickers = ["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","AMD","NFLX","PLTR"]
                items = []
                for ticker in tickers:
                    try:
                        daily = self._recent_daily_aggs(ticker, api_key, days_back=10, limit=10)
                        if not daily:
                            continue
                        day_bar = daily[-1]
                        prev_bar = daily[-2] if len(daily) > 1 else daily[-1]
                        last = float(day_bar.get("c", 0) or 0)
                        prev_close = float(prev_bar.get("c", 0) or 0)
                        pct = ((last - prev_close) / prev_close * 100) if prev_close else 0
                        items.append({"ticker": ticker, "changePct": pct, "price": last})
                    except Exception:
                        continue
                payload = {"ok": True, "items": items}
            else:
                self._mark_api("stocks", False, "unknown_stocks_endpoint")
                self._json_error(404, "unknown_stocks_endpoint", endpoint)
                return

            self._mark_api("stocks", True)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(json.dumps(payload).encode("utf-8"))
        except HTTPError as exc:
            self._mark_api("stocks", False, exc)
            if getattr(exc, "code", None) == 429:
                self._json_error(429, "stocks_rate_limited", str(exc))
            else:
                self._json_error(502, "stocks_upstream_error", str(exc))
        except (URLError, TimeoutError, ValueError) as exc:
            self._mark_api("stocks", False, exc)
            self._json_error(502, "stocks_upstream_error", str(exc))
        except Exception as exc:
            self._mark_api("stocks", False, exc)
            self._json_error(500, "stocks_proxy_error", str(exc))

    def log_message(self, format, *args):
        pass  # Suppress logging

class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

with ReusableTCPServer(("0.0.0.0", PORT), Handler) as httpd:
    print(f"Serving BTC Ticker at http://0.0.0.0:{PORT}")
    httpd.serve_forever()
