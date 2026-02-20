// ManagedWebSocket — reusable WebSocket with auto-reconnect
(function() {
    function ManagedWebSocket(opts) {
        this._getUrl = typeof opts.url === 'function' ? opts.url : function() { return opts.url; };
        this._onMessage = opts.onMessage || function() {};
        this._onConnect = opts.onConnect || function() {};
        this._onDisconnect = opts.onDisconnect || function() {};
        this._baseDelay = opts.reconnectDelay || 1000;
        this._maxDelay = opts.maxReconnectDelay || 30000;
        this._backoff = opts.backoff !== false;
        this._delay = this._baseDelay;
        this._ws = null;
        this._active = false;
        this._timer = null;
        this.lastMessage = 0;
    }

    ManagedWebSocket.prototype.connect = function() {
        this._active = true;
        this._delay = this._baseDelay;
        this._open();
    };

    ManagedWebSocket.prototype._open = function() {
        if (!this._active) return;
        var self = this;
        var ws = new WebSocket(this._getUrl());
        this._ws = ws;
        ws.onopen = function() {
            self._delay = self._baseDelay;
            self.lastMessage = Date.now();
            self._onConnect(ws);
        };
        ws.onmessage = function(e) {
            self.lastMessage = Date.now();
            self._onMessage(e, ws);
        };
        ws.onerror = function() { ws.close(); };
        ws.onclose = function() {
            self._onDisconnect();
            if (self._active) {
                self._timer = setTimeout(function() {
                    self._timer = null;
                    self._open();
                }, self._delay);
                if (self._backoff) {
                    self._delay = Math.min(self._delay * 2, self._maxDelay);
                }
            }
        };
    };

    ManagedWebSocket.prototype.disconnect = function() {
        this._active = false;
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
        if (this._ws) {
            this._ws.onclose = null;
            this._ws.close();
            this._ws = null;
        }
    };

    ManagedWebSocket.prototype.reconnect = function() {
        this.disconnect();
        this.connect();
    };

    ManagedWebSocket.prototype.send = function(data) {
        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            this._ws.send(data);
        }
    };

    window.ManagedWebSocket = ManagedWebSocket;
})();
