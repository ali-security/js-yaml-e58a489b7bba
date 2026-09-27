'use strict';

var assert = require('assert');
var yaml = require('../..');

// Resolving an `!!omap` used to remember every key seen so far in an array and
// scan it with `indexOf` for each following pair, so a map of N distinct keys
// cost O(N^2) comparisons. A document of this size resolves in well under a
// second with a hash based check, while the scan has to walk 2e10 array slots
// for it - minutes of CPU, way past mocha's per test timeout.
var STRESS_KEYS = 200000;

function createLargeOmap(count) {
  var lines = [ '--- !!omap' ];
  var i;

  for (i = 0; i < count; i++) {
    lines.push('- k' + i + ': ' + i);
  }

  return lines.join('\n') + '\n';
}

// Reads an own property without ever writing `object.__proto__`, so keys named
// after `Object.prototype` members can be inspected safely.
function ownValue(object, key) {
  var descriptor = Object.getOwnPropertyDescriptor(object, key);

  return descriptor ? descriptor.value : null;
}

// A big `!!omap` of distinct keys must load, and load in linear time - the
// quadratic scan does not finish inside the test timeout.
function assertLargeOmapResolves(impl) {
  var loaded = impl.load(createLargeOmap(STRESS_KEYS));
  var last;

  assert.ok(Array.isArray(loaded));
  assert.strictEqual(loaded.length, STRESS_KEYS);

  assert.deepEqual(Object.keys(loaded[0]), [ 'k0' ]);
  assert.strictEqual(ownValue(loaded[0], 'k0'), 0);

  last = loaded[STRESS_KEYS - 1];
  assert.deepEqual(Object.keys(last), [ 'k' + (STRESS_KEYS - 1) ]);
  assert.strictEqual(ownValue(last, 'k' + (STRESS_KEYS - 1)), STRESS_KEYS - 1);

  // Same document through the other entry points.
  assert.strictEqual(impl.safeLoad(createLargeOmap(1000)).length, 1000);
  assert.strictEqual(impl.loadAll(createLargeOmap(1000))[0].length, 1000);
}

// Duplicate detection, the only reason the accumulator exists, is unchanged.
function assertDuplicateOmapKeysRejected(impl) {
  assert.throws(function () {
    impl.load('--- !!omap\n- foo: 1\n- bar: 2\n- foo: 3\n');
  }, impl.YAMLException);

  assert.throws(function () {
    impl.load('--- !!omap [ foo: 1, bar: 2, foo: 3 ]\n');
  }, impl.YAMLException);

  // Keys inherited from `Object.prototype` have to be detected as duplicates
  // just the same. A plain `seen[key] = true` never records `__proto__` as an
  // own property, so this pair would silently pass.
  assert.throws(function () {
    impl.load('--- !!omap\n- __proto__: 1\n- __proto__: 2\n');
  }, impl.YAMLException);

  assert.throws(function () {
    impl.load('--- !!omap\n- hasOwnProperty: 1\n- hasOwnProperty: 2\n');
  }, impl.YAMLException);

  assert.throws(function () {
    impl.load('--- !!omap\n- toString: 1\n- constructor: 2\n- toString: 3\n');
  }, impl.YAMLException);
}

// Keys that merely look like `Object.prototype` members are distinct keys, not
// duplicates. A `key in seen` test would reject every one of them.
function assertPrototypeKeysAccepted(impl) {
  var loaded = impl.load([
    '--- !!omap',
    '- __proto__: 1',
    '- hasOwnProperty: 2',
    '- toString: 3',
    '- constructor: 4',
    '- valueOf: 5',
    '- isPrototypeOf: 6',
    ''
  ].join('\n'));

  assert.strictEqual(loaded.length, 6);
  assert.strictEqual(ownValue(loaded[0], '__proto__'), 1);
  assert.strictEqual(ownValue(loaded[1], 'hasOwnProperty'), 2);
  assert.strictEqual(ownValue(loaded[2], 'toString'), 3);
  assert.strictEqual(ownValue(loaded[3], 'constructor'), 4);
  assert.strictEqual(ownValue(loaded[4], 'valueOf'), 5);
  assert.strictEqual(ownValue(loaded[5], 'isPrototypeOf'), 6);

  // Neither the loaded pairs nor the resolver's key accumulator may end up
  // writing through to `Object.prototype`.
  loaded = impl.load('--- !!omap\n- __proto__:\n    polluted: true\n');

  assert.strictEqual(loaded.length, 1);
  assert.strictEqual(Object.getPrototypeOf(loaded[0]), Object.prototype);
  assert.strictEqual(typeof ({}).polluted, 'undefined');
  assert.strictEqual(Object.prototype.hasOwnProperty.call({}, 'polluted'), false);
}

// Entries that are not single key mappings stay invalid.
function assertMalformedOmapRejected(impl) {
  // Not a sequence.
  assert.throws(function () {
    impl.load('--- !!omap\nfoo: bar\n');
  }, impl.YAMLException);

  // Entry is a scalar.
  assert.throws(function () {
    impl.load('--- !!omap\n- foo: bar\n- baz\n');
  }, impl.YAMLException);

  // Entry holds more than one key.
  assert.throws(function () {
    impl.load('--- !!omap\n- foo: bar\n- baz: bar\n  bar: bar\n');
  }, impl.YAMLException);

  // Valid maps, empty or not, are untouched.
  assert.deepEqual(impl.load('--- !!omap []\n'), []);
  assert.deepEqual(impl.load('--- !!omap\n- foo: 1\n- bar: 2\n'), [ { foo: 1 }, { bar: 2 } ]);
}

suite('Ordered maps (!!omap)', function () {

  test('!!omap resolving stays linear in the number of keys', function () {
    assertLargeOmapResolves(yaml);
  });

  test('!!omap duplicate keys are still rejected', function () {
    assertDuplicateOmapKeysRejected(yaml);
  });

  test('!!omap keys named after Object.prototype members are accepted', function () {
    assertPrototypeKeysAccepted(yaml);
  });

  test('!!omap malformed entries are still rejected', function () {
    assertMalformedOmapRejected(yaml);
  });
});
