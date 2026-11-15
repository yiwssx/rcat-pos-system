#!/usr/bin/env node
// Execute against the *installed patched package*, not against a copied test
// implementation. Fail when the pnpm 4.3.1 patch isn't applied.
const assert = require("node:assert/strict");
const { readdirSync, readFileSync } = require("node:fs");
const path = require("node:path");

const store = path.resolve(__dirname, "../../node_modules/.pnpm");
const candidates = readdirSync(store).filter((name) =>
  name.startsWith("deepmerge@4.3.1"),
);
assert.equal(candidates.length, 1, "One deepmerge 4.3.1 patch expected");
const modulePath = require.resolve(
  path.join(store, candidates[0], "node_modules", "deepmerge"),
);
const loadedSource = readFileSync(modulePath, "utf8");
assert.match(
  loadedSource,
  /function keyIsForbidden\(key\)/,
  "The installed deepmerge package is unpatched: " + modulePath,
);
const deepmerge = require(modulePath);

function assertClean(result) {
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(result.isAdmin, undefined);
  for (const key of ["__proto__", "constructor", "prototype"]) {
    assert.equal(Object.hasOwn(result, key), false, key + " was copied");
  }
}
const hostile = JSON.parse(
  '{"__proto__":{"isAdmin":true},"constructor":{"isAdmin":true},' +
    '"prototype":{"isAdmin":true},"safe":{"passed":true}}',
);

// The security advisory PoC: null-prototype target with hostile source.
const flat = deepmerge(Object.create(null), hostile);
assertClean(flat);
assert.deepEqual(flat.safe, { passed: true });

// The vulnerable code also copied hostile *target* keys without filtering.
const target = JSON.parse(
  '{"__proto__":{"isAdmin":true},"constructor":{"isAdmin":true},' +
    '"prototype":{"isAdmin":true},"normal":"retained"}',
);
const fromTarget = deepmerge(target, { another: true });
assertClean(fromTarget);
assert.equal(fromTarget.normal, "retained");
assert.equal(fromTarget.another, true);

// Guard must apply recursively as well as to the root.
const nested = deepmerge({ config: Object.create(null) }, { config: hostile });
assertClean(nested.config);
assert.equal(nested.config.safe.passed, true);

// Ordinary build/test config merges must still work.
const benign = deepmerge(
  { env: { debug: false, region: "TH" }, list: [1] },
  { env: { debug: true }, list: [2] },
);
assert.deepEqual(benign, {
  env: { debug: true, region: "TH" },
  list: [1, 2],
});
assert.deepEqual(deepmerge.all([{ a: 1 }, { b: 2 }]), { a: 1, b: 2 });
assert.equal(Object.prototype.isAdmin, undefined);

console.log("PASS: installed pnpm-patched deepmerge blocks prototype poisoning");
