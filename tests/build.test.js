const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

describe('build output', function() {
    it('dist directory exists', function() {
        assert.ok(fs.existsSync(DIST), 'dist/ directory should exist — run npm run build first');
    });

    it('dist/app.min.js exists and is smaller than source', function() {
        var distFile = path.join(DIST, 'app.min.js');
        assert.ok(fs.existsSync(distFile), 'dist/app.min.js missing');
        var distSize = fs.statSync(distFile).size;
        var srcFiles = [
            'js/config-base.js', 'js/config.js', 'js/lib/ws.js', 'js/app.js',
            'js/settings.js', 'js/lib/indicators.js', 'js/btc.js', 'js/weather.js',
            'js/pc.js', 'js/stocks.js'
        ];
        var srcSize = srcFiles.reduce(function(sum, f) { return sum + fs.statSync(path.join(ROOT, f)).size; }, 0);
        assert.ok(distSize < srcSize, 'minified JS (' + distSize + ') should be smaller than source (' + srcSize + ')');
    });

    it('dist/app.min.css exists and is smaller than source', function() {
        var distFile = path.join(DIST, 'app.min.css');
        assert.ok(fs.existsSync(distFile), 'dist/app.min.css missing');
        var distSize = fs.statSync(distFile).size;
        var srcFiles = ['css/shared.css', 'css/btc.css', 'css/weather.css', 'css/pc.css', 'css/stocks.css'];
        var srcSize = srcFiles.reduce(function(sum, f) { return sum + fs.statSync(path.join(ROOT, f)).size; }, 0);
        assert.ok(distSize < srcSize, 'minified CSS (' + distSize + ') should be smaller than source (' + srcSize + ')');
    });

    it('dist/init.min.js exists', function() {
        assert.ok(fs.existsSync(path.join(DIST, 'init.min.js')));
    });

    it('dist/index.html references minified bundles', function() {
        var html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
        assert.ok(html.includes('app.min.js'), 'should reference app.min.js');
        assert.ok(html.includes('app.min.css'), 'should reference app.min.css');
        assert.ok(html.includes('init.min.js'), 'should reference init.min.js');
        assert.ok(!html.includes('src="js/config-base.js"'), 'should not reference individual JS files');
        assert.ok(!html.includes('href="css/shared.css"'), 'should not reference individual CSS files');
    });

    it('dist/sw.js references minified bundles', function() {
        var sw = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
        assert.ok(sw.includes('app.min.js'), 'sw.js should reference app.min.js');
        assert.ok(sw.includes('app.min.css'), 'sw.js should reference app.min.css');
        assert.ok(sw.includes('init.min.js'), 'sw.js should reference init.min.js');
    });

    it('dist has static assets', function() {
        assert.ok(fs.existsSync(path.join(DIST, 'manifest.json')));
        assert.ok(fs.existsSync(path.join(DIST, 'btcwallpaper.jpg')));
        assert.ok(fs.existsSync(path.join(DIST, 'weatherwallpaper.jpg')));
        assert.ok(fs.existsSync(path.join(DIST, 'pctempswallpaper.jpg')));
        assert.ok(fs.existsSync(path.join(DIST, 'build', 'icon.png')));
    });
});
