// Shared base runtime config used by both browser and desktop packaging code.
(function(root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
        return;
    }
    root.BTCT_BASE_CONFIG = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    return {
        app: {
            storageKey: 'btct_settings_v1',
            runtimeConfigKey: 'btct_runtime_config_v1'
        },
        btc: {
            defaultSymbol: 'BTCUSDT',
            defaultTimeframe: '1m',
            apiBase: 'https://api.binance.com',
            wsBase: 'wss://stream.binance.com:9443',
            fearGreedApi: 'https://api.alternative.me/fng/?limit=1',
            dominanceApi: 'https://api.coingecko.com/api/v3/global',
            heatmapCoins: ['BTCUSDT','ETHUSDT','BNBUSDT','XRPUSDT','SOLUSDT','ADAUSDT','DOGEUSDT','TRXUSDT','AVAXUSDT','LINKUSDT'],
            symbols: {
                'BTCUSDT': { name: 'Bitcoin', logo: '₿' },
                'ETHUSDT': { name: 'Ethereum', logo: 'Ξ' },
                'BNBUSDT': { name: 'BNB', logo: '◈' },
                'XRPUSDT': { name: 'XRP', logo: '✕' },
                'ADAUSDT': { name: 'Cardano', logo: '₳' },
                'DOGEUSDT': { name: 'Dogecoin', logo: 'Ð' },
                'SOLUSDT': { name: 'Solana', logo: '◎' },
                'DOTUSDT': { name: 'Polkadot', logo: '●' },
                'MATICUSDT': { name: 'Polygon', logo: '⬡' },
                'LTCUSDT': { name: 'Litecoin', logo: 'Ł' }
            },
            refresh: {
                wsHealthMs: 15000,
                liveBadgeMs: 2000,
                pressureDecayMs: 5000,
                fgiMs: 300000,
                dominanceMs: 300000,
                performanceMs: 300000,
                heatmapMs: 30000,
                canvasRefreshMs: 21600000
            },
            alerts: {
                desktop: true,
                audio: true,
                historyLimit: 20
            }
        },
        weather: {
            name: 'Dundee, UK',
            lat: 56.4620,
            lon: -2.9707,
            apiBase: 'https://api.open-meteo.com/v1/forecast',
            searchGeocodeBase: 'https://nominatim.openstreetmap.org/search',
            reverseGeocodeBase: 'https://nominatim.openstreetmap.org/reverse',
            refreshMs: 600000
        },
        pc: {
            endpoint: '/api/pc',
            pollMs: 2000,
            debug: false
        },
        theme: {
            btcImageOpacity: 0.14,
            weatherImageOpacity: 0.14,
            pcOverlayTop: 0.78,
            pcOverlayBottom: 0.82
        },
        stocks: {
            apiBase: '/api/stocks',
            allowClientApiKey: false
        }
    };
});
