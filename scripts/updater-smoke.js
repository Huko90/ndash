#!/usr/bin/env node
const assert = require('assert');

function apply(events) {
  let status = 'idle';
  for (const e of events) {
    if (e === 'checking') status = 'checking';
    else if (e === 'available') status = 'downloading';
    else if (e === 'not-available') status = 'up-to-date';
    else if (e === 'downloaded') status = 'ready';
    else if (e === 'error') status = 'error';
  }
  return status;
}

assert.strictEqual(apply(['checking', 'not-available']), 'up-to-date');
assert.strictEqual(apply(['checking', 'available', 'downloaded']), 'ready');
assert.strictEqual(apply(['checking', 'available', 'error']), 'error');

console.log('updater smoke: ok');
