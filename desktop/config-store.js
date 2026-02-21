const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  wizardCompleted: false,
  weather: {
    name: 'Dundee, UK',
    lat: 56.462,
    lon: -2.9707,
    refreshMs: 600000
  },
  btc: {
    defaultSymbol: 'BTCUSDT',
    alerts: {
      audio: true,
      volume: 0.06
    }
  },
  pc: {
    endpoint: '',
    pollMs: 2000
  },
  network: {
    httpPort: 8888,
    httpsPort: 8443,
    preferHttps: true
  },
  runtimeMode: 'app_open',
  trust: {
    thumbprint: '',
    firewallRuleNames: [],
    installedAt: 0
  }
};

function isObj(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(target, source) {
  if (!isObj(source)) return target;
  Object.keys(source).forEach((key) => {
    const sv = source[key];
    if (isObj(sv)) {
      if (!isObj(target[key])) target[key] = {};
      deepMerge(target[key], sv);
      return;
    }
    target[key] = sv;
  });
  return target;
}

class ConfigStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'btct-desktop-config.json');
    this.data = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.save();
        return;
      }
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (isObj(parsed)) deepMerge(this.data, parsed);
    } catch (err) {
      console.error('Failed to load config:', err.message);
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    return this.filePath;
  }

  get() {
    return JSON.parse(JSON.stringify(this.data));
  }

  update(patch) {
    deepMerge(this.data, patch || {});
    this.save();
    return this.get();
  }

  getFilePath() {
    return this.filePath;
  }
}

module.exports = {
  ConfigStore,
  DEFAULT_CONFIG,
  deepMerge
};
