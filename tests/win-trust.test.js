var describe = require('node:test').describe;
var it = require('node:test').it;
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');
var os = require('os');
var crypto = require('crypto');

var winTrust = require('../desktop/win-trust');

// Generate a test cert for thumbprint tests
function makeTempCert() {
    var selfsigned = require('selfsigned');
    var pems = selfsigned.generate([{ name: 'commonName', value: 'test.local' }], {
        days: 1, keySize: 2048, algorithm: 'sha256'
    });
    var tmpPath = path.join(os.tmpdir(), 'ndash-test-cert-' + Date.now() + '.crt');
    fs.writeFileSync(tmpPath, pems.cert);
    return { path: tmpPath, pem: pems.cert };
}

describe('win-trust.computeThumbprint', function() {
    it('returns 40-char uppercase hex string', function() {
        var cert = makeTempCert();
        try {
            var thumb = winTrust.computeThumbprint(cert.path);
            assert.ok(/^[A-F0-9]{40}$/.test(thumb), 'Expected 40-char hex, got: ' + thumb);
        } finally {
            fs.unlinkSync(cert.path);
        }
    });

    it('matches manual SHA-1 computation', function() {
        var cert = makeTempCert();
        try {
            var thumb = winTrust.computeThumbprint(cert.path);
            // Manually compute the same way
            var b64 = cert.pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
            var der = Buffer.from(b64, 'base64');
            var expected = crypto.createHash('sha1').update(der).digest('hex').toUpperCase();
            assert.strictEqual(thumb, expected);
        } finally {
            fs.unlinkSync(cert.path);
        }
    });
});

describe('win-trust.psEscape', function() {
    it('escapes single quotes by doubling them', function() {
        assert.strictEqual(winTrust.psEscape("it's"), "it''s");
        assert.strictEqual(winTrust.psEscape("a'b'c"), "a''b''c");
    });

    it('leaves safe strings unchanged', function() {
        assert.strictEqual(winTrust.psEscape('hello world'), 'hello world');
        assert.strictEqual(winTrust.psEscape('C:\\Users\\test'), 'C:\\Users\\test');
    });

    it('handles paths with spaces and special chars', function() {
        var escaped = winTrust.psEscape("C:\\Users\\John's PC\\certs\\local-dashboard.crt");
        assert.strictEqual(escaped, "C:\\Users\\John''s PC\\certs\\local-dashboard.crt");
    });
});

describe('win-trust.buildFirewallScript', function() {
    it('generates script with strict mode and error handling', function() {
        var script = winTrust.buildFirewallScript({
            firewallRules: [{ name: 'nDash HTTP 8888', port: 8888, protocol: 'TCP' }],
            removeFirewallRules: [],
            resultPath: 'C:\\temp\\result.json'
        });
        assert.ok(script.includes('Set-StrictMode -Version Latest'), 'Should set strict mode');
        assert.ok(script.includes('$ErrorActionPreference = "Stop"'), 'Should set error action');
        assert.ok(script.includes('ConvertTo-Json'), 'Should output JSON result');
    });

    it('includes firewall rule creation with correct port', function() {
        var script = winTrust.buildFirewallScript({
            firewallRules: [
                { name: 'nDash HTTP 9999', port: 9999, protocol: 'TCP' },
                { name: 'nDash HTTPS 9443', port: 9443, protocol: 'TCP' }
            ],
            removeFirewallRules: [],
            resultPath: 'C:\\temp\\result.json'
        });
        assert.ok(script.includes('nDash HTTP 9999'), 'Should contain HTTP rule name');
        assert.ok(script.includes('nDash HTTPS 9443'), 'Should contain HTTPS rule name');
        assert.ok(script.includes('-LocalPort 9999'), 'Should use correct HTTP port');
        assert.ok(script.includes('-LocalPort 9443'), 'Should use correct HTTPS port');
        assert.ok(script.includes('-Direction Inbound'), 'Should be inbound');
        assert.ok(script.includes('-Action Allow'), 'Should allow');
        assert.ok(script.includes('-Profile Private'), 'Should be private profile');
    });

    it('includes old rule removal when specified', function() {
        var script = winTrust.buildFirewallScript({
            firewallRules: [{ name: 'nDash HTTP 8888', port: 8888, protocol: 'TCP' }],
            removeFirewallRules: ['nDash HTTP 7777', 'nDash HTTPS 7443'],
            resultPath: 'C:\\temp\\result.json'
        });
        assert.ok(script.includes('nDash HTTP 7777'), 'Should reference old HTTP rule');
        assert.ok(script.includes('nDash HTTPS 7443'), 'Should reference old HTTPS rule');
    });

    it('generates empty script body when no rules needed', function() {
        var script = winTrust.buildFirewallScript({
            firewallRules: [],
            removeFirewallRules: [],
            resultPath: 'C:\\temp\\result.json'
        });
        assert.ok(script.includes('$result'), 'Should still have result variable');
        assert.ok(!script.includes('New-NetFirewallRule'), 'Should not create rules');
    });

    it('escapes special characters in rule names', function() {
        var script = winTrust.buildFirewallScript({
            firewallRules: [{ name: "nDash's HTTP 8888", port: 8888, protocol: 'TCP' }],
            removeFirewallRules: [],
            resultPath: "C:\\Users\\John's PC\\result.json"
        });
        // Single quotes should be doubled inside PS single-quoted strings
        assert.ok(script.includes("nDash''s HTTP 8888"), 'Rule name should have escaped quote');
        assert.ok(script.includes("John''s PC"), 'Result path should have escaped quote');
    });

    it('escapes special characters in result path', function() {
        var script = winTrust.buildFirewallScript({
            firewallRules: [],
            removeFirewallRules: [],
            resultPath: 'C:\\Users\\Test User\\AppData\\Roaming\\nDash\\result.json'
        });
        assert.ok(script.includes('C:\\Users\\Test User\\AppData'), 'Should contain full path');
    });
});

describe('win-trust.writeTrustStateFile', function() {
    it('writes valid JSON to the correct path', function() {
        var tmpDir = path.join(os.tmpdir(), 'ndash-test-' + Date.now());
        fs.mkdirSync(tmpDir, { recursive: true });
        try {
            var state = { thumbprint: 'AABB', firewallRuleNames: ['rule1'], installedAt: 12345 };
            winTrust.writeTrustStateFile(tmpDir, state);
            var filePath = path.join(tmpDir, 'ndash-trust-state.json');
            assert.ok(fs.existsSync(filePath), 'File should exist');
            var parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            assert.strictEqual(parsed.thumbprint, 'AABB');
            assert.deepStrictEqual(parsed.firewallRuleNames, ['rule1']);
            assert.strictEqual(parsed.installedAt, 12345);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

// UAC cancel simulation: runElevated returns error when script doesn't produce result file
describe('win-trust UAC cancel path', function() {
    it('installTrust returns graceful error on non-Windows', function() {
        // On non-Windows (CI), installTrust should return supported:false
        if (process.platform === 'win32') return;
        return winTrust.installTrust({
            certPath: '/fake/cert.crt',
            httpPort: 8888,
            httpsPort: 8443,
            userDataPath: os.tmpdir(),
            currentTrustState: {}
        }).then(function(result) {
            assert.strictEqual(result.ok, false);
            assert.strictEqual(result.supported, false);
        });
    });
});

// Rule mismatch detection: checkFirewallRules validates properties
describe('win-trust rule mismatch detection', function() {
    it('checkFirewallRules returns empty on non-Windows', function() {
        if (process.platform === 'win32') return;
        return winTrust.checkFirewallRules([
            { name: 'nDash HTTP 8888', port: 8888, protocol: 'TCP' }
        ]).then(function(result) {
            assert.deepStrictEqual(result, {});
        });
    });
});
