const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const app = require('../server');

test('state machine updates cabins and rejects invalid states', () => {
  app.setCabinState('store-001', 1, 'empty');
  const result = app.setCabinState('store-001', 1, 'full');
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(app.stores['store-001'].cabins[0].state, 'full');

  const invalid = app.setCabinState('store-001', 1, 'broken');
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /Invalid state/);
});

test('analytics records visits and dwell time when cabin leaves full state', () => {
  app.setCabinState('store-001', 2, 'empty');
  app.setCabinState('store-001', 2, 'full');
  app.setCabinState('store-001', 2, 'clearing');

  const summary = app.getStoreSummary('store-001', 60 * 60 * 1000);
  assert.ok(summary.totalVisits >= 1);
  assert.ok(summary.usageCountByCabin['2'] >= 1);
  assert.equal(typeof summary.currentFree, 'number');
});

test('loadConfig reads external store configuration', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cabin-config-'));
  const configPath = path.join(tempDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: 4999,
    stores: { 'store-test': { name: 'Test Store', cabinCount: 2 } },
  }));

  const config = app.loadConfig(configPath);
  assert.equal(config.port, 4999);
  assert.equal(config.stores['store-test'].name, 'Test Store');
  assert.equal(config.stores['store-test'].cabinCount, 2);
});
