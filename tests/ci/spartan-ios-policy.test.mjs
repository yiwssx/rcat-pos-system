import test from "node:test";
import assert from "node:assert/strict";
import { inspectSpartanUiPatch } from "../../scripts/ci/spartan-ios-policy.mjs";

const patch = (path, additions) =>
  `diff --git a/${path} b/${path}\n+++ b/${path}\n@@ -0,0 +1,${additions.length} @@\n${additions.map((line) => "+" + line).join("\n")}\n`;

test("existing feature CSS may be deleted but not enlarged with overrides", () => {
  const removal = "diff --git a/apps/customer/src/styles.css b/apps/customer/src/styles.css\n+++ b/apps/customer/src/styles.css\n@@ -1,2 +1,0 @@\n-.legacy { color: red; }\n-/* legacy */\n";
  assert.deepEqual(inspectSpartanUiPatch(removal), []);
  assert.equal(inspectSpartanUiPatch(patch("apps/merchant/src/app/catalog.css", [".catalog { padding: 1rem; }"])).length, 1);
  assert.equal(inspectSpartanUiPatch(patch("apps/customer/src/app/demo.scss", [".foo { color: red; }"])).length, 1);
});

test("shared semantic theme and font faces remain permitted", () => {
  assert.deepEqual(inspectSpartanUiPatch(patch("libs/ui/src/spartan-theme.css", ["--background: #f5f5f7;"])), []);
  assert.deepEqual(inspectSpartanUiPatch(patch("libs/ui/src/pos-thai-type.css", ["font-display: swap;"])), []);
  assert.equal(inspectSpartanUiPatch(patch("libs/ui/src/random-overrides.css", [".foo {color:red;}"])).length, 1);
});

test("new inline style bindings and raw colors are denied, semantic utilities allowed", () => {
  const route = "apps/customer/src/app/portal-home.page.ts";
  assert.deepEqual(inspectSpartanUiPatch(patch(route, ['class="rounded-xl bg-card p-6 text-foreground"'])), []);
  assert.equal(inspectSpartanUiPatch(patch(route, ['style="padding: 6px"'])).length, 1);
  assert.equal(inspectSpartanUiPatch(patch(route, ['[ngStyle]="custom"'])).length, 1);
  assert.equal(inspectSpartanUiPatch(patch(route, ['styles: [".foo {color:red}"],'])).length, 1);
  assert.equal(inspectSpartanUiPatch(patch(route, ['class="bg-[#ff00cc]"'])).length, 1);
});

test("migration docs, tests and API changes are not blocked by CSS policy", () => {
  assert.deepEqual(inspectSpartanUiPatch(patch("docs/SPARTAN-IOS-MIGRATION.md", ["no CSS"])), []);
  assert.deepEqual(inspectSpartanUiPatch(patch("apps/api/src/main.ts", ["const value = 42;"])), []);
});
