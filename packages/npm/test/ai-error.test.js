'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { aiError, AIHealError, redact } = require('../src');

function setup(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aie-'));
  const file = path.join(dir, 'buggy.js');
  fs.writeFileSync(file, source);
  return { dir, file, mod: require(file) };
}

const BUGGY = 'function divide(a, b) {\n  return a.value / b.value;\n}\nmodule.exports = { divide };\n';

test('returns the normal result when nothing throws', async () => {
  const add = aiError((a, b) => a + b, { complete: async () => '{}' });
  assert.equal(await add(2, 3), 5);
});

test('heals the failing function, reloads it and retries', async () => {
  const { dir, file, mod } = setup(BUGGY);
  const fixed = 'function divide(a, b) {\n  if (a == null || b == null) return NaN;\n  return a.value / b.value;\n}';
  const wrapped = aiError(mod.divide, {
    name: 'divide',
    allowedRoots: [dir],
    stateDir: path.join(dir, '.ai-error'),
    complete: async () => JSON.stringify({ canFix: true, replacement: fixed, explanation: 'guard null inputs' }),
  });
  assert.ok(Number.isNaN(await wrapped(null, { value: 1 })));
  assert.match(fs.readFileSync(file, 'utf8'), /a == null/);
  assert.ok(fs.readdirSync(path.join(dir, '.ai-error', 'backups')).length === 1);
});

test('refuses errors that come from outside the allowed scope', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aie-scope-'));
  const wrapped = aiError(() => { throw new Error('boom'); }, {
    allowedRoots: [dir],
    complete: async () => { throw new Error('should not be called'); },
  });
  await assert.rejects(wrapped(), (err) => err instanceof AIHealError && err.code === 'SCOPE');
});

test('throws actionable advice when the model says the fix is out of scope', async () => {
  const { dir, mod } = setup(BUGGY);
  const wrapped = aiError(mod.divide, {
    name: 'divide',
    allowedRoots: [dir],
    stateDir: path.join(dir, '.ai-error'),
    complete: async () => JSON.stringify({ canFix: false, replacement: null, userAdvice: 'Set the VALUE field on the input objects in the caller.' }),
  });
  await assert.rejects(wrapped(null, { value: 1 }), (err) => {
    assert.equal(err.code, 'UNFIXABLE');
    assert.match(err.message, /Set the VALUE field/);
    return true;
  });
});

test('redact removes API keys and known secrets', () => {
  const out = redact('key sk-abcdefghijklmnopqrstuvwxyz123456 and hunter2hunter2', ['hunter2hunter2']);
  assert.ok(!out.includes('sk-abcdef'));
  assert.ok(!out.includes('hunter2hunter2'));
});
