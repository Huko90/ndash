#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const JS_FILES = [
    'js/config-base.js',
    'js/config.js',
    'js/lib/ws.js',
    'js/app.js',
    'js/settings.js',
    'js/lib/indicators.js',
    'js/btc.js',
    'js/weather.js',
    'js/pc.js',
    'js/stocks.js'
];

const CSS_FILES = [
    'css/shared.css',
    'css/btc.css',
    'css/weather.css',
    'css/pc.css',
    'css/stocks.css'
];

const COPY_FILES = [
    'btcwallpaper.jpg',
    'weatherwallpaper.jpg',
    'pctempswallpaper.jpg',
    'manifest.json'
];

// --- Helpers ---
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

function concat(files) {
    return files.map(function(f) { return '/* ' + f + ' */\n' + read(f); }).join('\n');
}

function minify(input, outFile, ext) {
    var tmpIn = path.join(DIST, '_tmp_bundle.' + ext);
    fs.writeFileSync(tmpIn, input);
    execSync('npx esbuild ' + JSON.stringify(tmpIn) + ' --minify --outfile=' + JSON.stringify(outFile), { cwd: ROOT });
    fs.unlinkSync(tmpIn);
}

function fileSize(p) {
    try { return fs.statSync(p).size; } catch (e) { return 0; }
}

function fmtKB(bytes) { return (bytes / 1024).toFixed(1) + ' KB'; }

// --- Build ---
console.log('Building nDash...');
var t0 = Date.now();

// Clean & create dist
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
fs.mkdirSync(path.join(DIST, 'build'), { recursive: true });

// 1. Bundle + minify JS
var jsBundle = concat(JS_FILES);
var jsBundlePath = path.join(DIST, 'app.min.js');
minify(jsBundle, jsBundlePath, 'js');

// 2. Bundle + minify CSS
var cssBundle = concat(CSS_FILES);
var cssBundlePath = path.join(DIST, 'app.min.css');
minify(cssBundle, cssBundlePath, 'css');

// 3. Minify init.js
var initSrc = read('js/init.js');
var initPath = path.join(DIST, 'init.min.js');
minify(initSrc, initPath, 'js');

// 4. Generate dist/index.html from source
var html = read('index.html');

// Replace individual CSS links with single bundle
html = html.replace(
    /<link rel="stylesheet" href="css\/shared\.css">[\s\S]*?<link rel="stylesheet" href="css\/pc\.css">/,
    '<link rel="stylesheet" href="app.min.css">'
);

// Replace individual JS scripts with single bundle + init
html = html.replace(
    /<script src="js\/config-base\.js"><\/script>[\s\S]*?<script src="js\/pc\.js"><\/script>/,
    '<script src="app.min.js"></script>'
);
html = html.replace(
    '<script src="js/init.js"></script>',
    '<script src="init.min.js"></script>'
);

fs.writeFileSync(path.join(DIST, 'index.html'), html);

// 5. Generate dist/sw.js with updated pre-cache list
var swSrc = read('sw.js');
// Replace SHELL_FILES array
var distShellFiles = [
    '/',
    '/index.html',
    '/manifest.json',
    '/build/icon.png',
    '/app.min.css',
    '/app.min.js',
    '/init.min.js',
    '/btcwallpaper.jpg',
    '/weatherwallpaper.jpg'
];
swSrc = swSrc.replace(
    /var SHELL_FILES = \[[\s\S]*?\];/,
    'var SHELL_FILES = ' + JSON.stringify(distShellFiles, null, 4) + ';'
);
// Auto cache-bust: hash the minified bundles for a unique cache version
var bundleHash = crypto.createHash('md5')
    .update(fs.readFileSync(jsBundlePath))
    .update(fs.readFileSync(cssBundlePath))
    .update(fs.readFileSync(initPath))
    .digest('hex').slice(0, 8);
swSrc = swSrc.replace(/var CACHE_VERSION = '[^']+';/, "var CACHE_VERSION = 'ndash-" + bundleHash + "';");
fs.writeFileSync(path.join(DIST, 'sw.js'), swSrc);

// 6. Copy static assets
COPY_FILES.forEach(function(f) {
    var src = path.join(ROOT, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(DIST, f));
});
// Copy icon
var iconSrc = path.join(ROOT, 'build', 'icon.png');
if (fs.existsSync(iconSrc)) fs.copyFileSync(iconSrc, path.join(DIST, 'build', 'icon.png'));

// 7. Report
var jsOrigSize = JS_FILES.reduce(function(sum, f) { return sum + fileSize(path.join(ROOT, f)); }, 0);
var cssOrigSize = CSS_FILES.reduce(function(sum, f) { return sum + fileSize(path.join(ROOT, f)); }, 0);
var jsMinSize = fileSize(jsBundlePath);
var cssMinSize = fileSize(cssBundlePath);

console.log('');
console.log('  JS:  ' + fmtKB(jsOrigSize) + ' -> ' + fmtKB(jsMinSize) + ' (' + Math.round((1 - jsMinSize / jsOrigSize) * 100) + '% smaller)');
console.log('  CSS: ' + fmtKB(cssOrigSize) + ' -> ' + fmtKB(cssMinSize) + ' (' + Math.round((1 - cssMinSize / cssOrigSize) * 100) + '% smaller)');
console.log('');
console.log('  dist/index.html');
console.log('  dist/app.min.js');
console.log('  dist/app.min.css');
console.log('  dist/init.min.js');
console.log('  dist/sw.js');
console.log('');
console.log('Build complete in ' + (Date.now() - t0) + 'ms');
