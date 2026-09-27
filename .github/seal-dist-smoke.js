'use strict';

// Checks that the browser bundles rebuilt by `make browserify` carry the
// merge-limit and !!omap fixes. The mocha suite only covers lib/.

var assert = require('assert');
var path = require('path');

function repeat(str, count) {
  var out = '';
  for (var i = 0; i < count; i++) out += str;
  return out;
}

function mergeChain(count) {
  var lines = [ 'a0: &a0 { k0: 0 }' ];
  for (var i = 1; i < count; i++) {
    lines.push('a' + i + ': &a' + i + ' { <<: *a' + (i - 1) + ', k' + i + ': ' + i + ' }');
  }
  lines.push('b: *a' + (count - 1));
  return lines.join('\n') + '\n';
}

function repeatedAliases(keys, aliases) {
  var pairs = [];
  for (var i = 0; i < keys; i++) pairs.push('k' + i + ': 0');
  var refs = [];
  for (var j = 0; j < aliases; j++) refs.push('*a');
  return 'a: &a { ' + pairs.join(', ') + ' }\nb: { <<: [ ' + refs.join(', ') + ' ] }\n';
}

function emptySources(sources, targets) {
  var items = [];
  for (var i = 0; i < sources; i++) items.push('{}');
  return 'arr: &arr [' + items.join(',') + ']\ntargets:\n' + repeat('  - <<: *arr\n', targets);
}

function omap(count) {
  var lines = [ '--- !!omap' ];
  for (var i = 0; i < count; i++) lines.push('- k' + i + ': ' + i);
  return lines.join('\n') + '\n';
}

[ 'dist/js-yaml.js', 'dist/js-yaml.min.js' ].forEach(function (file) {
  var yaml = require(path.resolve(file));

  assert.deepStrictEqual(yaml.load('a: &a { x: 1 }\nb: { <<: *a, y: 2 }\n').b, { x: 1, y: 2 });

  // CVE-2026-59869
  assert.throws(function () { yaml.load(mergeChain(200)); }, /maxTotalMergeKeys/);
  assert.strictEqual(yaml.load(mergeChain(200), { maxTotalMergeKeys: -1 }).b.k199, 199);

  // CVE-2026-53550
  assert.throws(function () { yaml.load(repeatedAliases(200, 100)); }, /maxTotalMergeKeys/);

  // CVE-2026-84375
  assert.throws(function () { yaml.load(emptySources(100, 200)); }, /maxTotalMergeKeys/);
  assert.throws(function () { yaml.load(emptySources(101, 1)); }, /abnormal merge sequence size/);

  // GHSA-5p4m-2wfm-xmqj
  assert.throws(function () { yaml.load('--- !!omap\n- a: 1\n- a: 2\n'); }, /omap/);
  var started = Date.now();
  assert.strictEqual(yaml.load(omap(100000)).length, 100000);
  assert.ok(Date.now() - started < 5000, file + ': 100000-entry !!omap took ' + (Date.now() - started) + 'ms');

  console.log(file + ': ok');
});
