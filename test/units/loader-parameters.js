'use strict';

var assert = require('assert');
var yaml = require('../..');


function assertYamlException(fn, pattern) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof yaml.YAMLException, 'expected YAMLException, got ' + error.name);

    if (pattern) {
      assert.ok(pattern.test(error.message), 'expected "' + error.message + '" to match ' + pattern);
    }

    return;
  }

  assert.fail('expected YAMLException');
}


// Each `a{i}` merges the previous anchor and adds a single key, so the final
// mapping has `count` keys while the loader copies ~count^2/2 keys in total.
function createMergeChain(count) {
  var lines = [ 'a0: &a0 { k0: 0 }' ];
  var i;

  for (i = 1; i < count; i += 1) {
    lines.push('a' + i + ': &a' + i + ' { <<: *a' + (i - 1) + ', k' + i + ': ' + i + ' }');
  }

  lines.push('b: *a' + (count - 1));

  return lines.join('\n') + '\n';
}


// A single anchor with `keys` keys, merged `repetitions` times into the same
// mapping, so the loader walks `repetitions * keys` keys in total.
function createRepeatedMergeAliasPattern(repetitions, keys) {
  var src = [];
  var aliases = [];
  var i;

  for (i = 0; i < keys; i += 1) {
    src.push('k' + i + ': 0');
  }

  for (i = 0; i < repetitions; i += 1) {
    aliases.push('*a');
  }

  return '\na: &a {' + src.join(', ') + '}\nb: { <<: [ ' + aliases.join(', ') + ' ] }\n';
}


// `n` distinct anchors that carry no key at all, folded into one merge
// sequence. Merging them copies nothing, so the only work the loader can
// account for is the merge sources themselves.
function createEmptyMergeSequence(n) {
  var lines = [];
  var aliases = [];
  var i;

  for (i = 0; i < n; i += 1) {
    lines.push('e' + i + ': &e' + i + ' {}');
    aliases.push('*e' + i);
  }

  lines.push('b: { <<: [ ' + aliases.join(', ') + ' ] }');

  return lines.join('\n') + '\n';
}


// `n` anchored single-key mappings, all folded into one merge sequence.
function createMergeSequence(n) {
  var lines = [];
  var aliases = [];
  var i;

  for (i = 0; i < n; i += 1) {
    lines.push('- &x' + i + ' {a' + i + ': ' + i + '}');
    aliases.push('*x' + i);
  }

  return lines.join('\n') + '\n- <<: [' + aliases.join(', ') + ']\n';
}


var MULTI_DOCUMENT_MERGE = [
  '',
  '---',
  'a: &a { k1: 1, k2: 2 }',
  'b: { <<: *a }',
  '---',
  'a: &a { k1: 1, k2: 2 }',
  'b: { <<: *a }',
  ''
].join('\n');


suite('loader parameters', function () {
  var testStr = 'test: 1 \ntest: 2';
  var expected =  [ { test: 2 } ];
  var result;

  test('loadAll(input, options)', function () {
    result = yaml.loadAll(testStr, { json: true });
    assert.deepEqual(result, expected);

    result = [];
    yaml.loadAll(testStr, function (doc) {
      result.push(doc);
    }, { json: true });
    assert.deepEqual(result, expected);
  });

  test('loadAll(input, null, options)', function () {
    result = yaml.loadAll(testStr, null, { json: true });
    assert.deepEqual(result, expected);

    result = [];
    yaml.loadAll(testStr, function (doc) {
      result.push(doc);
    }, { json: true });
    assert.deepEqual(result, expected);
  });

  test('safeLoadAll(input, options)', function () {
    result = yaml.safeLoadAll(testStr, { json: true });
    assert.deepEqual(result, expected);

    result = [];
    yaml.safeLoadAll(testStr, function (doc) {
      result.push(doc);
    }, { json: true });
    assert.deepEqual(result, expected);
  });

  test('safeLoadAll(input, null, options)', function () {
    result = yaml.safeLoadAll(testStr, null, { json: true });
    assert.deepEqual(result, expected);

    result = [];
    yaml.safeLoadAll(testStr, function (doc) {
      result.push(doc);
    }, { json: true });
    assert.deepEqual(result, expected);
  });

  test('maxTotalMergeKeys - caps total merge keys', function () {
    // Three sources of one key each: every source costs itself plus its key.
    assert.doesNotThrow(function () {
      yaml.load(createMergeSequence(3), { maxTotalMergeKeys: 6 });
    });

    assert.throws(function () {
      yaml.load(createMergeSequence(3), { maxTotalMergeKeys: 5 });
    }, /maxTotalMergeKeys/);

    assert.throws(function () {
      yaml.load(createMergeSequence(3), { maxTotalMergeKeys: 2 });
    }, /maxTotalMergeKeys/);

    assert.doesNotThrow(function () {
      yaml.load(createMergeSequence(3), { maxTotalMergeKeys: -1 });
    });

    var chained = yaml.load(createMergeChain(150), { maxTotalMergeKeys: -1 });

    assert.strictEqual(Object.keys(chained.b).length, 150);
  });

  test('maxTotalMergeKeys - default cap stops a pathological merge chain', function () {
    assertYamlException(function () {
      yaml.load(createMergeChain(100000));
    }, /merge keys exceeded maxTotalMergeKeys \(10000\)/);
  });

  test('maxTotalMergeKeys - default cap stops repeated merge aliases', function () {
    // A merge sequence that stays within the allowed sequence size still has
    // to pay for every key of every repetition.
    assertYamlException(function () {
      yaml.load(createRepeatedMergeAliasPattern(100, 20000));
    }, /merge keys exceeded maxTotalMergeKeys \(10000\)/);
  });

  test('maxTotalMergeKeys - every merge source is counted', function () {
    // Repeated aliases are not deduplicated, so three sources of two keys
    // each consume nine of the allowance: three sources plus six keys.
    assert.doesNotThrow(function () {
      yaml.load(createRepeatedMergeAliasPattern(3, 2), { maxTotalMergeKeys: 9 });
    });

    assert.throws(function () {
      yaml.load(createRepeatedMergeAliasPattern(3, 2), { maxTotalMergeKeys: 8 });
    }, /maxTotalMergeKeys/);

    var merged = yaml.load(createRepeatedMergeAliasPattern(3, 2), { maxTotalMergeKeys: -1 });

    assert.deepEqual(merged.b, { k0: 0, k1: 0 });
  });

  test('loadAll - maxTotalMergeKeys is shared across all documents', function () {
    // Each document costs one source plus its two keys, so three is enough
    // for a single document but not for both.
    assert.doesNotThrow(function () {
      yaml.loadAll(MULTI_DOCUMENT_MERGE, { maxTotalMergeKeys: 6 });
    });

    assert.throws(function () {
      yaml.loadAll(MULTI_DOCUMENT_MERGE, { maxTotalMergeKeys: 3 });
    }, /maxTotalMergeKeys/);
  });

  test('safeLoad - maxTotalMergeKeys is honoured', function () {
    assert.doesNotThrow(function () {
      yaml.safeLoad(createMergeSequence(3), { maxTotalMergeKeys: 6 });
    });

    assert.throws(function () {
      yaml.safeLoad(createMergeSequence(3), { maxTotalMergeKeys: 2 });
    }, /maxTotalMergeKeys/);

    assertYamlException(function () {
      yaml.safeLoad(createMergeChain(100000));
    }, /merge keys exceeded maxTotalMergeKeys \(10000\)/);
  });

  test('safeLoadAll - maxTotalMergeKeys is shared across all documents', function () {
    assert.doesNotThrow(function () {
      yaml.safeLoadAll(MULTI_DOCUMENT_MERGE, { maxTotalMergeKeys: 6 });
    });

    assert.throws(function () {
      yaml.safeLoadAll(MULTI_DOCUMENT_MERGE, { maxTotalMergeKeys: 3 });
    }, /maxTotalMergeKeys/);

    assert.throws(function () {
      yaml.safeLoadAll(MULTI_DOCUMENT_MERGE, null, { maxTotalMergeKeys: 3 });
    }, /maxTotalMergeKeys/);
  });

  test('merge sequences are limited to 100 sources', function () {
    // The budget is switched off, so only the merge sequence size can stop
    // these documents.
    assert.doesNotThrow(function () {
      yaml.load(createEmptyMergeSequence(100), { maxTotalMergeKeys: -1 });
    });

    assertYamlException(function () {
      yaml.load(createEmptyMergeSequence(101), { maxTotalMergeKeys: -1 });
    }, /abnormal merge sequence size/);
  });

  test('merge sources that contribute no key are still charged', function () {
    // Empty sources copy nothing, so a per-key budget alone never notices
    // them however long the merge sequence gets.
    assert.doesNotThrow(function () {
      yaml.load(createEmptyMergeSequence(100), { maxTotalMergeKeys: 100 });
    });

    assert.throws(function () {
      yaml.load(createEmptyMergeSequence(100), { maxTotalMergeKeys: 99 });
    }, /maxTotalMergeKeys/);
  });

  test('a merge sequence within the limits still merges every source', function () {
    var loaded = yaml.load(createMergeSequence(100));

    assert.strictEqual(Object.keys(loaded[100]).length, 100);
    assert.strictEqual(loaded[100].a0, 0);
    assert.strictEqual(loaded[100].a99, 99);
  });

  test('repeating one alias in a merge sequence cannot force quadratic work', function () {
    // GHSA-h67p-54hq-rp68: a single anchor of K keys aliased M times inside
    // one merge sequence walks K * M keys - ~64M for the advisory's K = M =
    // 8000, which took seconds on an unpatched loader.
    var poc = createRepeatedMergeAliasPattern(8000, 8000);

    assertYamlException(function () {
      yaml.load(poc);
    }, /abnormal merge sequence size/);

    // The sequence size is rejected even when the merge-key budget is off.
    assertYamlException(function () {
      yaml.load(poc, { maxTotalMergeKeys: -1 });
    }, /abnormal merge sequence size/);
  });

  test('repeating a standalone merge key cannot force quadratic work', function () {
    // `<<` may legally repeat as separate keys, which sidesteps the merge
    // sequence size; the per-source and per-key charges bound that path.
    var lines = [ 'a: &a { k0: 0, k1: 1 }', 'b:' ];
    var i;

    for (i = 0; i < 20000; i += 1) {
      lines.push('  <<: *a');
    }

    assertYamlException(function () {
      yaml.load(lines.join('\n') + '\n');
    }, /merge keys exceeded maxTotalMergeKeys \(10000\)/);
  });
});
