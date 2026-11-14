// G4 CI-only real HTTP burst + Chromium ordering/merchant browser E2E.
// Uses the existing ephemeral rcat_ci_test fixtures. No live payment or external app.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const { setTimeout: delay } = require("node:timers/promises");
const { Pool } = require("pg");
const { chromium, devices } = require("playwright");

if (
  process.env.CI !== "true" ||
  process.env.PGDATABASE !== "rcat_ci_test" ||
  !["localhost", "127.0.0.1", "::1"].includes(process.env.PGHOST)
) throw new Error("G4 HTTP/browser E2E only runs against loopback ephemeral CI PostgreSQL");

const apiPort = 3000; // Angular /api proxy files target this port.
const customerPort = 31947;
const merchantPort = 31948;
const apiOrigin = "http://127.0.0.1:" + apiPort;
const customer = "https://127.0.0.1:" + customerPort;
const merchant = "https://127.0.0.1:" + merchantPort;
const tenant = "00000000-0000-4000-8000-000000000001";
const store = "20000000-0000-4000-8000-000000000001";
const orderScope = "/api/tenants/" + tenant + "/stores/" + store;
const children = [];
const db = new Pool({ max: 3 });
let browser;

function start(name, command, args, env = {}) {
  const p = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ring = [];
  for (const stream of [p.stdout, p.stderr]) {
    stream.on("data", (chunk) => {
      ring.push(String(chunk));
      if (ring.length > 100) ring.shift();
    });
  }
  const service = { name, process: p, ring };
  children.push(service);
  return service;
}

async function untilHealthy(url, service, timeoutMs = 160000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (service.process.exitCode !== null) {
      throw new Error(service.name + " exited: " + service.ring.join("").slice(-5000));
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return;
    } catch { /* starting */ }
    await delay(400);
  }
  throw new Error("Timeout waiting for " + service.name + "\n" + service.ring.join("").slice(-4000));
}

async function post(url, data, headers = {}) {
  return fetch(url, {
    method: "POST",
    headers: { Origin: customer, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(25000),
  });
}

function percentile(numbers, pct) {
  const sorted = [...numbers].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(sorted.length * pct / 100) - 1]);
}
async function burst(tasks, name, expectedStatus = 201) {
  const results = await Promise.all(tasks.map(async (fn) => {
    const start = performance.now();
    try {
      const res = await fn();
      const data = await res.json();
      return { status: res.status, data, ms: performance.now() - start };
    } catch (e) {
      return { status: -1, data: String(e), ms: performance.now() - start };
    }
  }));
  const metrics = {
    scenario: name,
    requests: results.length,
    statuses: results.reduce((map, r) => {
      map[r.status] = (map[r.status] ?? 0) + 1;
      return map;
    }, {}),
    p50ms: percentile(results.map((r) => r.ms), 50),
    p95ms: percentile(results.map((r) => r.ms), 95),
  };
  console.log(JSON.stringify(metrics));
  assert.ok(results.every((r) => r.status === expectedStatus),
    "Unexpected HTTP result in " + name + ": " +
    JSON.stringify(results.filter((r) => r.status !== expectedStatus).slice(0, 3)));
  return results;
}

async function merchantLoginRequest(context) {
  const res = await context.request.post(merchant + "/api/auth/login", {
    headers: { Origin: merchant },
    data: { email: "a@test.invalid", password: "example-password-2026" },
  });
  assert.equal(res.status(), 200, await res.text());
  const cookies = await context.cookies(merchant);
  assert.ok(cookies.some((x) => x.name === "__Host-rcat_session"), "Merchant browser did not retain session cookie");
  assert.ok(cookies.some((x) => x.name === "__Host-rcat_csrf"), "Merchant browser did not retain CSRF cookie");
}

async function apiSetup() {
  const login = await fetch(merchant + "/api/auth/login", {
    method: "POST",
    headers: { Origin: merchant, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "a@test.invalid", password: "example-password-2026" }),
  });
  assert.equal(login.status, 200, await login.text());
  const raw = login.headers.getSetCookie().map((value) => value.split(";")[0]);
  const csrf = raw.find((v) => v.startsWith("__Host-rcat_csrf="));
  assert.ok(csrf);
  const headers = {
    Origin: merchant,
    "Content-Type": "application/json",
    Cookie: raw.join("; "),
    "X-CSRF-Token": csrf.split("=")[1],
  };
  const suffix = randomUUID().slice(0, 12);
  const catRes = await fetch(merchant + orderScope + "/catalog/categories", {
    method: "POST", headers,
    body: JSON.stringify({ slug: "g4-e2e-" + suffix, name: "G4 E2E QA" }),
  });
  assert.equal(catRes.status, 201, await catRes.clone().text());
  const { categoryId } = await catRes.json();
  const name = "G4 QA bowl " + suffix;
  const itemRes = await fetch(merchant + orderScope + "/catalog/products", {
    method: "POST", headers,
    body: JSON.stringify({ categoryId, name, priceSatang: 12500 }),
  });
  assert.equal(itemRes.status, 201, await itemRes.clone().text());
  const { productId } = await itemRes.json();
  const tableRes = await fetch(merchant + orderScope + "/tables", {
    method: "POST", headers,
    body: JSON.stringify({ label: "G4 " + suffix }),
  });
  assert.equal(tableRes.status, 201, await tableRes.clone().text());
  const { tableId } = await tableRes.json();
  async function rotate() {
    const res = await fetch(merchant + orderScope + "/tables/" + tableId + "/rotate", {
      method: "POST", headers,
    });
    assert.equal(res.status, 201, await res.clone().text());
    const body = await res.json();
    const uri = new URL(body.orderingUrl);
    assert.equal(uri.pathname, "/order");
    const token = decodeURIComponent(uri.hash.slice("#token=".length));
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    return token;
  }
  return { name, productId, tableId, categoryId, merchantHeaders: headers,
    token: await rotate(), rotate };
}

async function browserFlow(fixture) {
  // CI-only ephemeral self-signed HTTPS certificate. Service Worker script
  // downloads use Chromium's network verifier, not Playwright's context
  // ignoreHTTPSErrors flag. Never apply this browser flag to real devices.
  browser = await chromium.launch({
    headless: true,
    args: ["--ignore-certificate-errors"],
  });
  const guestContext = await browser.newContext({
    ...devices["iPhone 13"],
    browserName: undefined,
    baseURL: customer,
    ignoreHTTPSErrors: true,
  });
  const merchantContext = await browser.newContext({
    viewport: { width: 1365, height: 900 },
    baseURL: merchant,
    ignoreHTTPSErrors: true,
  });
  const secondContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    baseURL: merchant,
    ignoreHTTPSErrors: true,
  });
  const guest = await guestContext.newPage();
  const board = await merchantContext.newPage();
  const second = await secondContext.newPage();

  try {
    // Open a genuine table QR fragment and confirm it is scrubbed before
    // a browser history / screenshot / URL could accidentally expose it.
    await guest.goto(customer + "/order#token=" + fixture.token);
    await guest.locator(".guest-product", { hasText: fixture.name }).waitFor();
    assert.equal(new URL(guest.url()).hash, "", "QR token leaked into URL after load");
    assert.ok(await guest.getByText("ยังไม่มีการชำระเงินผ่าน PromptPay").count());
    // G2: a narrow 320px viewport must retain searchable menu and
    // checkout without a horizontal document scrollbar.
    await guest.setViewportSize({ width: 320, height: 700 });
    assert.equal(await guest.getByRole("searchbox", { name: "ค้นหาเมนู" }).count(), 1);
    const viewport = await guest.evaluate(() => ({
      visible: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    assert.ok(viewport.documentWidth <= viewport.visible + 1,
      "Guest menu overflows 320px screen: " + JSON.stringify(viewport));

    // A5: iOS-style category chips remain reachable with a keyboard.
    const menuSearch = guest.getByRole("searchbox", { name: "ค้นหาเมนู" });
    await menuSearch.focus();
    assert.equal(await menuSearch.evaluate((node) => node === document.activeElement), true,
      "Guest search cannot receive keyboard focus");
    await guest.keyboard.press("Tab");
    assert.equal(await guest.getByRole("button", { name: "ทั้งหมด", exact: true })
      .evaluate((node) => node === document.activeElement), true,
      "Guest category chips are not reachable by keyboard");
    // Detail view uses the native modal dialog, with Escape restoring focus.
    const firstDish = guest.locator(".guest-product", { hasText: fixture.name });
    await firstDish.getByRole("button", { name: "ดูรายละเอียด " + fixture.name }).click();
    const sheet = guest.getByRole("dialog", { name: fixture.name });
    await sheet.waitFor();
    assert.ok(await sheet.getByText("125.00 ฿").count() >= 1);
    await guest.keyboard.press("Escape");
    await sheet.waitFor({ state: "hidden" });

    // iPhone offline: do not submit an Order or silently mutate cart;
    // reconnect and submit through the visible Angular button.
    await guest.locator(".guest-product", { hasText: fixture.name })
      .getByRole("button", { name: "เพิ่มลงตะกร้า" }).click();
    const itemSheet = guest.getByRole("dialog", { name: fixture.name });
    await itemSheet.getByRole("textbox", { name: /หมายเหตุสำหรับเมนูนี้/ })
      .fill("ไม่ใส่ผัก");
    await itemSheet.getByRole("button", { name: /เพิ่มลงตะกร้า · ประมาณ/ }).click();
    await guest.getByRole("button", { name: "ดูตะกร้า" }).click();
    const cartSheet = guest.getByRole("dialog", { name: "ตะกร้าของฉัน" });
    await cartSheet.waitFor();
    await cartSheet.getByRole("textbox", { name: /ชื่อผู้สั่ง/ })
      .fill("นาย ก");
    await cartSheet.getByRole("textbox", { name: /สถานที่รับ\/ส่ง/ })
      .fill("อาคาร ข");
    const checkout = cartSheet.getByRole("button", { name: /ยืนยันส่งคำสั่งซื้อ/ });
    await checkout.waitFor();
    await guestContext.setOffline(true);
    await guest.evaluate(() => window.dispatchEvent(new Event("offline")));
    await guest.waitForTimeout(150);
    assert.ok(await checkout.isDisabled(), "Offline customer could submit checkout");
    await guestContext.setOffline(false);
    await guest.evaluate(() => window.dispatchEvent(new Event("online")));
    await checkout.click();
    await guest.waitForURL("**/order/track", { timeout: 20000 });
    await guest.getByText("Payment: not_requested").waitFor();
    const orderLabel = (await guest.locator(".guest-track-id").innerText())
      .match(/#[0-9]{3,}/)?.[0];
    assert.ok(orderLabel, "Customer tracking page missing public Order number");
    assert.ok((await guest.locator(".guest-order-state").innerText()).length > 0);
    // G2: tracking is explicitly marked stale when the device drops the
    // connection. Reconnecting should revalidate server status, not
    // claim Payment success or expose the Order bearer.
    await guestContext.setOffline(true);
    await guest.evaluate(() => window.dispatchEvent(new Event("offline")));
    await guest.getByText("ออฟไลน์ · สถานะออเดอร์ล่าสุดอาจเปลี่ยนแล้ว", {
      exact: false,
    }).waitFor();
    assert.ok(await guest.locator(".guest-track-actions button").first().isDisabled());
    await guestContext.setOffline(false);
    await guest.evaluate(() => window.dispatchEvent(new Event("online")));
    await guest.waitForFunction(() => {
      const btn = document.querySelector(".guest-track-actions button");
      return !!btn && !btn.disabled && btn.textContent.includes("ตรวจสถานะล่าสุด");
    }, { timeout: 20000 });

    // Two real independent merchant browser contexts, each with its own
    // HttpOnly session, CSRF cookie and SSE/periodic order board.
    await Promise.all([
      merchantLoginRequest(merchantContext),
      merchantLoginRequest(secondContext),
    ]);
    const route = merchant + "/orders/" + tenant + "/" + store;
    await Promise.all([board.goto(route), second.goto(route)]);
    const selector = 'article[aria-label="ออเดอร์ ' + orderLabel + '"]';
    await board.locator(selector).waitFor({ timeout: 20000 });
    await second.locator(selector).waitFor({ timeout: 20000 });
    await board.locator(selector).getByText("นาย ก", { exact: true }).waitFor();
    await board.locator(selector).getByText("อาคาร ข", { exact: true }).waitFor();
    await board.locator(selector).getByText("ไม่ใส่ผัก").waitFor();
    // A5: the Merchant Order acceptance control must be keyboard-focusable.
    const acceptAction = board.locator(selector).getByRole("button", { name: "รับออเดอร์" });
    await acceptAction.focus();
    assert.equal(await acceptAction.evaluate((node) => node === document.activeElement), true,
      "Merchant acceptance control cannot receive keyboard focus");
    await acceptAction.click();
    await board.locator(selector).getByText("รับออเดอร์แล้ว").waitFor({ timeout: 20000 });
    await second.locator(selector).getByText("รับออเดอร์แล้ว").waitFor({ timeout: 20000 });

    // G3: simulate a mobile Merchant suspended in the background with the
    // connection offline. A distinct submitted Order must not be lost while
    // its SSE stream is paused; resuming must reconcile the real DB Inbox.
    await secondContext.setOffline(true);
    await second.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("offline"));
    });
    await second.getByText("การเชื่อมต่อขาด", { exact: false })
      .waitFor({ timeout: 15000 });
    const resumedOrder = await post(customer + "/api/guest/orders", {
      visitToken: fixture.token,
      orderedBy: "ผู้ทดสอบการเชื่อมต่อ",
      deliverTo: "อาคาร ข",
      items: [{ productId: fixture.productId, quantity: 1, optionIds: [], note: "" }],
    }, { "Idempotency-Key": "resume-" + randomUUID() });
    assert.equal(resumedOrder.status, 201, await resumedOrder.clone().text());
    const {
      orderId: resumedOrderId,
      displayNumber: resumedDisplayNumber,
      paymentState: resumedPaymentState,
    } = await resumedOrder.json();
    assert.match(resumedOrderId, /^[a-f0-9-]{36}$/i);
    assert.match(resumedDisplayNumber, /^[1-9][0-9]*$/);
    assert.equal(resumedPaymentState, "not_requested");
    const resumedSelector =
      'article[aria-label="ออเดอร์ #' +
      resumedDisplayNumber.padStart(3, "0") + '"]';
    assert.equal(await second.locator(resumedSelector).count(), 0,
      "Suspended offline Merchant must not invent unseen Orders");
    await secondContext.setOffline(false);
    await second.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("focus"));
    });
    await second.locator(resumedSelector).waitFor({ timeout: 20000 });
    await second.locator(resumedSelector).getByText("รอรับออเดอร์")
      .waitFor({ timeout: 15000 });

    // A foreground refresh should pick up the new status on the guest tab
    // without claiming the Order has been paid or losing the tracking secret.
    await guest.getByRole("button", { name: "ตรวจสถานะล่าสุด" }).click();
    await guest.locator(".guest-order-state").getByText("รับออเดอร์แล้ว").waitFor({ timeout: 20000 });
    assert.ok(await guest.getByText("Payment: not_requested").isVisible(),
      "Customer tracking did not retain explicit unverified payment state");

    // Real mobile Merchant Catalog UX: CSRF owner creates a category and
    // product, edits its price, then archives the product without touching
    // the original Order fixture or its payment state.
    await second.goto(merchant + "/catalog/" + tenant + "/" + store);
    const createDisclosure = second.locator("details.catalog-create");
    await createDisclosure.locator("summary").click();
    assert.ok(
      await createDisclosure.evaluate((element) => element.open),
      "Creation forms must be reachable via the disclosure",
    );
    await second.getByRole("heading", { name: "เพิ่มหมวดหมู่" }).waitFor();
    await second.getByLabel("ชื่อหมวดหมู่").fill("E2E ทดสอบเมนู");
    await second.getByLabel("รหัสหมวดหมู่ (ภาษาอังกฤษ)")
      .fill("e2e-catalog-check");
    await second.getByRole("button", { name: "เพิ่มหมวดหมู่" }).click();
    await second.getByText("เพิ่มหมวดหมู่แล้ว").waitFor();

    await second.getByLabel("ชื่อสินค้า", { exact: true }).fill("เมนูทดสอบชั่วคราว");
    await second.getByLabel("หมวดหมู่", { exact: true })
      .selectOption({ label: "E2E ทดสอบเมนู" });
    await second.getByLabel("ราคาขาย (บาท)").fill("85.25");
    await second.getByRole("button", { name: "เพิ่มสินค้า" }).click();
    await second.getByText("เพิ่มสินค้าแล้ว").waitFor();

    const newItem = second.locator(".catalog-product", {
      hasText: "เมนูทดสอบชั่วคราว",
    });
    await newItem.getByRole("button", { name: "แก้ไข" }).click();
    const editForm = newItem.locator(".catalog-edit");
    await editForm.getByLabel("ชื่อสินค้า", { exact: true })
      .fill("เมนูทดสอบแก้ไขแล้ว");
    await editForm.getByLabel("ราคาขายใหม่ (บาท)").fill("99.50");
    await second.getByRole("button", { name: "บันทึกการแก้ไข" }).click();
    await second.getByText("บันทึกข้อมูลสินค้าแล้ว").waitFor();
    const revisedItem = second.locator(".catalog-product", {
      hasText: "เมนูทดสอบแก้ไขแล้ว",
    });
    await revisedItem.getByText("99.50 บาท").waitFor();
    // G2 multi-group editor: a draft typed for one group must never be
    // submitted to another group. Only one option form may own input IDs.
    await revisedItem.getByRole("button", { name: "จัดการตัวเลือกสินค้า" }).click();
    const modifiers = revisedItem.locator(".catalog-modifier-panel");
    const createGroup = modifiers.locator("form").first();
    for (const group of [
      { name: "ความหวาน E2E", slug: "e2e-sweet" },
      { name: "เพิ่มท็อปปิ้ง E2E", slug: "e2e-toppings" },
    ]) {
      await createGroup.getByLabel("ชื่อกลุ่ม").fill(group.name);
      await createGroup.getByLabel("รหัสกลุ่ม").fill(group.slug);
      await createGroup.getByLabel("เลือกขั้นต่ำ").fill("0");
      await createGroup.getByLabel("เลือกสูงสุด").fill("1");
      await createGroup.getByRole("button", { name: "เพิ่มกลุ่ม" }).click();
      // Success text may still be visible from the previous create.
      // Await the newly committed group row, not a stale status banner.
      await modifiers.getByRole("heading", { name: new RegExp(group.name) })
        .waitFor({ timeout: 20000 });
    }
    assert.equal(
      await modifiers.getByRole("button", { name: "เพิ่มตัวเลือก", exact: true }).count(),
      2, "Both modifier groups must have their own add action",
    );
    assert.equal(await modifiers.locator('input[name="newOptionName"]').count(), 0);
    await modifiers.getByRole("button", { name: "เพิ่มตัวเลือก", exact: true })
      .first().click();
    await modifiers.getByLabel("ชื่อตัวเลือก", { exact: true }).fill("ข้อความค้าง E2E");
    const previousOptionFormId =
      await modifiers.locator('form[id^="new-option-form-"]').getAttribute("id");
    assert.ok(previousOptionFormId);
    // Switching groups is async in the Angular view. Wait for the DOM to
    // mount the second group's uniquely identified form before asserting.
    await modifiers.getByRole("button", { name: "เพิ่มตัวเลือก", exact: true })
      .click();
    await second.waitForFunction((oldId) => {
      const form = document.querySelector(
        '.catalog-modifier-panel form[id^="new-option-form-"]',
      );
      return form && form.id !== oldId;
    }, previousOptionFormId, { timeout: 15000 });
    const activeName = modifiers.locator('input[name="newOptionName"]');
    assert.equal(await activeName.count(), 1);
    assert.equal(await activeName.inputValue(), "",
      "Modifier draft from a different group must not leak into new group");
    assert.equal(await modifiers.locator('[id="new-option-name"]').count(), 1);
    await activeName.fill("ซอส E2E");
    await modifiers.getByLabel("ราคาเพิ่ม/ลด (บาท)", { exact: true })
      .fill("2.50");
    await modifiers.getByRole("button", { name: "บันทึกตัวเลือกใหม่" }).click();
    await second.getByText("เพิ่มตัวเลือกสินค้าแล้ว").waitFor();
    const scopedCatalog = await secondContext.request.get(
      merchant + orderScope + "/catalog/products/page?limit=20",
    );
    assert.equal(scopedCatalog.status(), 200, await scopedCatalog.text());
    const catalogData = await scopedCatalog.json();
    const sweetGroup = catalogData.modifierGroups.find((g) => g.slug === "e2e-sweet");
    const toppingsGroup = catalogData.modifierGroups.find((g) => g.slug === "e2e-toppings");
    const savedOption = catalogData.modifierOptions.find((o) => o.name === "ซอส E2E");
    assert.ok(sweetGroup && toppingsGroup && savedOption,
      "Both groups and the correct added option must persist in scoped Catalog");
    assert.equal(savedOption.groupId, toppingsGroup.id,
      "Draft switched groups but submitted option was attached to wrong group");
    assert.notEqual(savedOption.groupId, sweetGroup.id);
    assert.equal(savedOption.priceDeltaSatang, 250);

    // Real Chromium canvas PNG -> bounded WebP conversion -> restricted
    // binary upload. Public active-only media must load as an image and be
    // denied for foreign tenancy or after this product is archived.
    const sourcePng = await second.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 180;
      const context = canvas.getContext("2d");
      context.fillStyle = "#db8532";
      context.fillRect(0, 0, 320, 180);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    const mediaReplies = [];
    second.on("response", async (response) => {
      if (response.url().endsWith("/image") && response.request().method() === "PUT") {
        let detail;
        try { detail = (await response.text()).slice(0, 450); }
        catch { detail = "(body unavailable)"; }
        mediaReplies.push({ status: response.status(), detail });
      }
    });
    await revisedItem.locator('input[type="file"]').setInputFiles({
      name: "catalog-menu-test.png",
      mimeType: "image/png",
      buffer: Buffer.from(sourcePng, "base64"),
    });
    try {
      await second.getByText("บันทึกรูปสินค้าแล้ว").waitFor({ timeout: 10000 });
    } catch {
      const uiError = await second.locator(".catalog-error").allTextContents();
      throw new Error("WebP upload did not succeed. UI=" +
        JSON.stringify(uiError) + " responses=" + JSON.stringify(mediaReplies));
    }
    const imageInputId = await revisedItem.locator('input[type="file"]').getAttribute("id");
    const mediaProductId = imageInputId.replace("catalog-media-", "");
    const publicMediaUrl = customer + "/api/guest/catalog-media/" + tenant + "/" + store + "/" + mediaProductId;
    const activeMedia = await secondContext.request.get(publicMediaUrl);
    assert.equal(activeMedia.status(), 200, await activeMedia.text().catch(() => ""));
    assert.match(activeMedia.headers()["content-type"] ?? "", /^image\/webp/);
    assert.equal(activeMedia.headers()["x-content-type-options"], "nosniff");
    await revisedItem.locator(".catalog-media-preview").waitFor();
    // The img element can be visible before Chromium finishes decoding the
    // asynchronous WebP response (especially after loading four local Thai
    // font faces). Wait for actual browser decode, not an arbitrary sleep.
    await second.waitForFunction(
      () => [...document.querySelectorAll(".catalog-media-preview")]
        .some((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0),
      null,
      { timeout: 15000 },
    );
    const foreignMedia = await secondContext.request.get(
      customer + "/api/guest/catalog-media/" + tenant +
        "/20000000-0000-4000-8000-000000000002/" + mediaProductId,
    );
    assert.equal(foreignMedia.status(), 404);

    second.once("dialog", (dialog) => dialog.accept());
    await revisedItem.getByRole("button", { name: "เก็บถาวร" }).click();
    await second.getByText("เก็บสินค้าถาวรแล้ว").waitFor();
    await second.getByRole("button", { name: "แสดงสินค้าเก็บถาวร" }).click();
    await second.locator(".catalog-product", {
      hasText: "เมนูทดสอบแก้ไขแล้ว",
    }).getByText("เก็บถาวร").waitFor();
    assert.equal((await secondContext.request.get(publicMediaUrl)).status(), 404,
      "Archived image must no longer be publicly served");

    // Printed QR is an immutable public locator; merchant owner controls
    // whether scanning grants an ordering session (never a Payment QR).
    await second.goto(merchant + "/tables/" + tenant + "/" + store);
    await second.getByRole("heading", { name: "QR สั่งอาหารติดโต๊ะ" }).waitFor();
    await second.getByLabel("ชื่อโต๊ะ").fill("QR code E2E");
    await second.getByRole("button", { name: "เพิ่มโต๊ะ" }).click();
    await second.getByText("เพิ่มโต๊ะแล้ว").waitFor();
    const tableUrl = (await second.locator(".table-url").innerText()).trim();
    const scanned = new URL(tableUrl);
    assert.equal(scanned.origin, customer);
    assert.equal(scanned.pathname, "/order");
    assert.equal(scanned.hash, "", "Static printable QR contained a bearer");
    assert.deepEqual([...scanned.searchParams.keys()].sort(), ["store", "table", "tenant"]);
    const printedId = scanned.searchParams.get("table");
    const svgResponse = await secondContext.request.get(
      merchant + orderScope + "/tables/" + printedId + "/print-qr.svg",
    );
    assert.equal(svgResponse.status(), 200, await svgResponse.text());
    const qrSvg = await svgResponse.text();
    assert.match(svgResponse.headers()["content-type"], /^image\/svg\+xml/);
    assert.match(qrSvg, /<svg/);
    assert.match(qrSvg, /<path/);
    assert.ok(await second.locator(".table-qr")
      .evaluate((img) => img.complete && img.naturalWidth > 0),
    "Printable QR SVG did not render");

    // Seeded CI store is open to preserve existing G4 Order fixtures.
    await second.getByRole("button", { name: "ปิดรับออเดอร์", exact: true }).click();
    await second.getByRole("button", { name: "เปิดรับออเดอร์", exact: true }).waitFor();
    await guest.goto(tableUrl);
    await guest.getByRole("heading", {
      name: "ขออภัย ร้านยังไม่เปิดให้สั่งอาหาร",
    }).waitFor();
    assert.equal(await guest.locator(".guest-product").count(), 0,
      "Closed store must not show an orderable menu");
    assert.equal(await guest.locator(".guest-code-form").count(), 0,
      "Printed QR must not ask for an eight-digit staff code");
    const closed = await post(customer + "/api/guest/ordering-table/open",
      { tenantId: tenant, storeId: store, tableId: printedId });
    assert.equal(closed.status, 201);
    const closedData = await closed.json();
    assert.equal(closedData.open, false);
    assert.equal(closedData.visitToken, undefined,
      "Closed store must not mint guest bearer");

    await second.getByRole("button", { name: "เปิดรับออเดอร์", exact: true }).click();
    await second.getByRole("button", { name: "ปิดรับออเดอร์", exact: true }).waitFor();
    await guest.getByRole("button", { name: "ตรวจสอบอีกครั้ง" }).click();
    await guest.locator(".guest-product", { hasText: fixture.name }).waitFor();
    assert.equal(new URL(guest.url()).hash, "", "Guest bearer leaked into URL hash");
    assert.equal(new URL(guest.url()).searchParams.has("token"), false,
      "Guest bearer leaked in URL query");
    const grants = await Promise.all([0, 1].map(() => post(
      customer + "/api/guest/ordering-table/open",
      { tenantId: tenant, storeId: store, tableId: printedId },
    )));
    assert.ok(grants.every((r) => r.status === 201));
    const tokens = await Promise.all(grants.map((r) => r.json()));
    assert.ok(tokens.every((t) => t.open && t.visitToken?.length === 43));
    assert.notEqual(tokens[0].visitToken, tokens[1].visitToken,
      "Distinct scans must not share an ordering bearer");

    // A close must block a prior valid grant at the API, not only the UI.
    await second.getByRole("button", { name: "ปิดรับออเดอร์", exact: true }).click();
    await second.getByRole("button", { name: "เปิดรับออเดอร์", exact: true }).waitFor();
    const refused = await post(customer + "/api/guest/orders", {
      visitToken: tokens[0].visitToken,
      orderedBy: "ผู้ทดสอบ",
      deliverTo: "อาคาร ข",
      items: [{ productId: fixture.productId, quantity: 1, optionIds: [], note: "" }],
    }, { "Idempotency-Key": "closed-static-qr-e2e-01" });
    assert.equal(refused.status, 409,
      "Closing a store blocks new Order submissions from valid guest grants");
    await second.getByRole("button", { name: "เปิดรับออเดอร์", exact: true }).click();
    await second.getByRole("button", { name: "ปิดรับออเดอร์", exact: true }).waitFor();

    // Expire the first merchant session with real logout + CSRF, then
    // refresh the browser to prove stale tab access is no longer authorized.
    const stored = await merchantContext.cookies(merchant);
    const csrf = stored.find((c) => c.name === "__Host-rcat_csrf")?.value;
    assert.ok(csrf);
    const logout = await merchantContext.request.post(merchant + "/api/auth/logout", {
      headers: { Origin: merchant, "X-CSRF-Token": csrf },
    });
    assert.equal(logout.status(), 204, await logout.text());
    await board.reload();
    await board.getByText("เซสชันหมดอายุ").waitFor({ timeout: 20000 });

    console.log(JSON.stringify({
      browser: "Chromium", viewport: "mobile customer + desktop/mobile merchant",
      result: "PASS",
      scenarios: ["QR URL scrub", "320px keyboard/search a11y", "offline submit block", "tracked checkout", "offline tracking and revalidation",
        "independent merchant tabs", "order status propagation", "Merchant offline/sleep resume reconciliation", "mobile catalog WebP conversion + guest photo", "mobile catalog create/edit/archive", "static printed QR and staff code redemption/revocation", "expired session denied"],
    }));
  } catch (error) {
    for (const [name, page] of [["guest", guest], ["merchant", board], ["second", second]]) {
      try {
        await page.screenshot({ path: "/tmp/rcat-e2e-" + name + ".png", fullPage: true });
      } catch { /* failure diagnostics are optional */ }
    }
    throw error;
  } finally {
    await Promise.allSettled([
      guestContext.close(), merchantContext.close(), secondContext.close(),
    ]);
  }
}

async function guestCatalogHttp(fixture) {
  // Real merchant HTTP creates 30 extra menu items after the first Browser
  // Ordering scenario. No fake order/money state or direct SQL catalog writes.
  const items = await Promise.all(Array.from({ length: 30 }, async (_, i) => {
    const started = performance.now();
    const res = await fetch(merchant + orderScope + "/catalog/products", {
      method: "POST",
      headers: fixture.merchantHeaders,
      body: JSON.stringify({
        categoryId: fixture.categoryId,
        name: "G2 paged รายการ " + String(i).padStart(2, "0"),
        priceSatang: 2200 + i,
      }),
    });
    assert.equal(res.status, 201, await res.clone().text());
    return performance.now() - started;
  }));
  const requestPage = async (data) => {
    const started = performance.now();
    const response = await post(customer + "/api/guest/ordering-visit/page", {
      token: fixture.token, limit: 20, search: "", categoryId: null,
      cursor: null, ...data,
    });
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    return { body, ms: performance.now() - started };
  };
  const first = await requestPage({});
  const second = await requestPage({ cursor: first.body.nextCursor });
  assert.equal(first.body.products.length, 20);
  assert.equal(second.body.products.length, 11);
  assert.equal(first.body.hasMore, true);
  assert.equal(second.body.hasMore, false);
  assert.equal(second.body.nextCursor, null);
  assert.equal(first.body.tableId, fixture.tableId);
  assert.equal(first.body.tenantId, tenant);
  const ids = [...first.body.products, ...second.body.products].map((p) => p.id);
  assert.equal(new Set(ids).size, 31);
  assert.ok(first.body.products.every((p) => typeof p.priceSatang === "number"));
  const search = await requestPage({ search: "G2 paged", limit: 50 });
  assert.equal(search.body.products.length, 30);
  const foreignCategory = await requestPage({
    categoryId: "00000000-0000-4000-8000-000000000002",
  });
  assert.equal(foreignCategory.body.products.length, 0);
  const malformed = await post(customer + "/api/guest/ordering-visit/page", {
    token: fixture.token, limit: 51,
  });
  assert.equal(malformed.status, 400);
  const denied = await post(customer + "/api/guest/ordering-visit/page", {
    token: "A".repeat(43), limit: 24,
  });
  assert.equal(denied.status, 404);
  const forbidden = await post(customer + "/api/guest/ordering-visit/page", {
    token: fixture.token,
  }, { Origin: "https://untrusted.example" });
  assert.equal(forbidden.status, 403);
  const selected = [{ productId: fixture.productId, quantity: 1, optionIds: [] }];
  const reviewStarted = performance.now();
  const reviewed = await post(customer + "/api/guest/ordering-visit/review-cart", {
    token: fixture.token, items: selected,
  });
  const reviewedText = await reviewed.text();
  assert.equal(reviewed.status, 201, reviewedText);
  const reviewMs = Math.round(performance.now() - reviewStarted);
  const reviewedData = JSON.parse(reviewedText);
  assert.equal(reviewedData.products.length, 1, "Scoped review returned full menu");
  assert.equal(reviewedData.products[0].id, fixture.productId);
  assert.equal(reviewedData.tenantId, tenant);
  const full = await post(customer + "/api/guest/ordering-visit/resolve", {
    token: fixture.token,
  });
  assert.equal(full.status, 201);
  const fullText = await full.text();
  assert.ok(
    Buffer.byteLength(reviewedText) < Buffer.byteLength(fullText),
    "Cart-only preflight did not reduce Guest response bytes",
  );
  const badCart = await post(customer + "/api/guest/ordering-visit/review-cart", {
    token: fixture.token, items: Array.from({ length: 21 }, () => selected[0]),
  });
  assert.equal(badCart.status, 400);
  const badBearer = await post(customer + "/api/guest/ordering-visit/review-cart", {
    token: "A".repeat(43), items: selected,
  });
  assert.equal(badBearer.status, 404);
  const badOrigin = await post(customer + "/api/guest/ordering-visit/review-cart", {
    token: fixture.token, items: selected,
  }, { Origin: "https://untrusted.example" });
  assert.equal(badOrigin.status, 403);
  console.log(JSON.stringify({
    scenario: "G2 scoped checkout preflight",
    reviewMs,
    selectedItems: selected.length,
    reviewBytes: Buffer.byteLength(reviewedText),
    fullCatalogBytes: Buffer.byteLength(fullText),
    malformedAndForged: "denied",
  }));
  console.log(JSON.stringify({
    scenario: "G2 server-side Guest keyset + real HTTP menu load",
    products: ids.length,
    catalogCreateP95Ms: percentile(items, 95),
    pageFirstMs: Math.round(first.ms),
    pageNextMs: Math.round(second.ms),
    searchMs: Math.round(search.ms),
    crossStoreAndBadOrigin: "denied",
  }));
}

async function browserPwaOfflineRecovery() {
  // A separate authenticated Chromium context exercises the real SW, not
  // only the node:vm mock. Cached navigation must never show stale Orders.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    baseURL: merchant,
    ignoreHTTPSErrors: true,
    serviceWorkers: "allow",
  });
  const page = await context.newPage();
  const route = merchant + "/orders/" + tenant + "/" + store;
  try {
    await merchantLoginRequest(context);
    await page.goto(route);
    await page.locator(".order-card").first().waitFor({ timeout: 20000 });
    const liveOrder = await page.locator(".order-card").first().getAttribute("aria-label");
    assert.ok(liveOrder?.startsWith("ออเดอร์ "), "Missing current Merchant Order");

    const registration = await page.evaluate(async () => {
      const worker = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });
      await navigator.serviceWorker.ready;
      return worker.active?.state === "activated";
    });
    assert.equal(registration, true, "Merchant Service Worker never activated");
    await page.reload();
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
      undefined,
      { timeout: 15000 },
    );
    await page.locator(".order-card").first().waitFor();
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.getByText("การเชื่อมต่อขาด", { exact: false })
      .waitFor({ timeout: 15000 });
    // Inspect the real Chromium Cache Storage while its browser context is
    // disconnected. Offline navigation interception itself is verified in
    // the deterministic SW fetch-handler test (network emulation can differ
    // for a browser worker target versus a page target).
    const cachedOfflineHtml = await page.evaluate(async () => {
      const offline = await caches.match("/offline.html");
      return offline ? offline.text() : "";
    });
    assert.ok(cachedOfflineHtml.includes("อุปกรณ์ขาดการเชื่อมต่อ"),
      "Offline warning page unavailable from real Service Worker Cache Storage");
    assert.ok(!cachedOfflineHtml.includes(liveOrder),
      "Cached informational offline page leaked an Order identifier");
    const cachedNames = await page.evaluate(async () => {
      const names = [];
      for (const key of await caches.keys()) {
        const cache = await caches.open(key);
        for (const request of await cache.keys()) {
          names.push(new URL(request.url).pathname);
        }
      }
      return names;
    });
    assert.ok(cachedNames.includes("/offline.html"));
    assert.ok(cachedNames.every((path) =>
      !path.startsWith("/api") && !path.startsWith("/orders/") &&
      !path.startsWith("/auth")),
    "PWA cache contained private application data: " + JSON.stringify(cachedNames));
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.goto(route);
    await page.locator(".order-card").first().waitFor({ timeout: 20000 });
    assert.ok((await page.locator(".order-card").first().getAttribute("aria-label"))
      ?.startsWith("ออเดอร์ "),
    "Merchant PWA did not reconcile real Orders after offline navigation");
    console.log(JSON.stringify({
      scenario: "G3 Chromium activated SW offline cache audit + reconnect",
      result: "PASS",
      privateOrderCache: "none",
      offlinePageCache: "informational only",
    }));
  } finally {
    await context.close();
  }
}

async function httpLoad(fixture) {
  const batchSize = 24;
  const payload = {
    visitToken: fixture.token,
    orderedBy: "ผู้ทดสอบโหลด",
    deliverTo: "อาคารทดสอบ",
    items: [{ productId: fixture.productId, quantity: 1, optionIds: [], note: "" }],
  };
  const missingContext = await post(customer + "/api/guest/orders", {
    visitToken: fixture.token,
    items: payload.items,
  }, { "Idempotency-Key": "missing-fields-" + randomUUID() });
  assert.equal(missingContext.status, 400, "Direct API bypassed required fields");
  const shared = "http-duplicate-" + randomUUID();
  const repeated = await burst(
    Array.from({ length: batchSize }, () =>
      () => post(customer + "/api/guest/orders", payload, { "Idempotency-Key": shared })),
    "24 simultaneous HTTP same-key Orders",
  );
  assert.equal(new Set(repeated.map((x) => x.data.orderId)).size, 1);
  const changedPayload = {
    ...payload,
    items: [{ ...payload.items[0], note: "หวานมาก" }],
  };
  const changed = await post(customer + "/api/guest/orders", changedPayload, {
    "Idempotency-Key": shared,
  });
  assert.equal(changed.status, 409, "Changed item note reused a committed key");
  assert.equal(repeated.filter((x) => x.data.replayed === false).length, 1);
  assert.equal(repeated.filter((x) => x.data.replayed === true).length, batchSize - 1);
  assert.ok(repeated.every((x) => x.data.amountSatang === 12500 &&
    x.data.paymentState === "not_requested"));
  const unique = await burst(
    Array.from({ length: batchSize }, () =>
      () => post(customer + "/api/guest/orders", payload, {
        "Idempotency-Key": "http-unique-" + randomUUID(),
      })),
    "24 simultaneous HTTP unique Orders",
  );
  assert.equal(new Set(unique.map((x) => x.data.orderId)).size, batchSize);
  const result = await db.query(
    "SELECT count(*)::int AS total FROM rcat.orders WHERE tenant_id=$1 AND store_id=$2 AND table_id=$3 AND status='submitted'",
    [tenant, store, fixture.tableId],
  );
  // Browser's initial Order is accepted, but the reconnect scenario
  // creates one more submitted Order. Include it in both Inbox and Outbox.
  const resumedSubmitted = 1;
  assert.equal(result.rows[0].total, batchSize + 1 + resumedSubmitted);
  const outbox = await db.query(
    "SELECT count(*)::int AS total FROM rcat.order_outbox_events WHERE tenant_id=$1 AND store_id=$2 AND table_id=$3 AND event_type='order.submitted'",
    [tenant, store, fixture.tableId],
  );
  assert.equal(outbox.rows[0].total, batchSize + 2 + resumedSubmitted, "HTTP retries duplicated outbox");
  const oldToken = fixture.token;
  await fixture.rotate();
  const denied = await burst(
    Array.from({ length: 8 }, () =>
      () => post(customer + "/api/guest/orders",
        { ...payload, visitToken: oldToken },
        { "Idempotency-Key": "http-revoked-" + randomUUID() })),
    "8 revoked QR HTTP Order attempts",
    404,
  );
  assert.equal(denied.length, 8);
  const final = await db.query(
    "SELECT count(*)::int AS total FROM rcat.orders WHERE tenant_id=$1 AND store_id=$2 AND table_id=$3",
    [tenant, store, fixture.tableId],
  );
  assert.equal(final.rows[0].total, batchSize + 2 + resumedSubmitted);
  console.log("PASS: real HTTP idempotency, scoped Order snapshots, transactional Outbox, revoked QR");
}

async function main() {
  const api = start("NestJS API", process.execPath, ["dist/apps/api/src/main.js"], {
    NODE_ENV: "test",
    PORT: String(apiPort),
    ENABLE_DEVELOPMENT_AUTH: "true",
    AUTH_ALLOWED_ORIGINS: customer + "," + merchant,
    GUEST_ORDER_BASE_URL: customer + "/order",
    AUTH_DATABASE_URL:
      "postgres://rcat_auth_ci:ci-auth-only@127.0.0.1:5432/rcat_ci_test",
    TENANT_DATABASE_URL:
      "postgres://rcat_app_ci:ci-tenant-only@127.0.0.1:5432/rcat_ci_test",
  });
  await untilHealthy(apiOrigin + "/api/health", api);
  const app1 = start("Angular Customer", "pnpm",
    ["exec", "ng", "serve", "customer", "--host", "127.0.0.1", "--port", String(customerPort),
      "--ssl", "--ssl-cert", "/tmp/rcat-g4-cert.pem", "--ssl-key", "/tmp/rcat-g4-key.pem"]);
  const app2 = start("Angular Merchant", "pnpm",
    ["exec", "ng", "serve", "merchant", "--host", "127.0.0.1", "--port", String(merchantPort),
      "--ssl", "--ssl-cert", "/tmp/rcat-g4-cert.pem", "--ssl-key", "/tmp/rcat-g4-key.pem"]);
  await Promise.all([
    untilHealthy(customer + "/order", app1),
    untilHealthy(merchant + "/", app2),
  ]);

  const fixture = await apiSetup();
  await browserFlow(fixture);
  await browserPwaOfflineRecovery();
  await guestCatalogHttp(fixture);
  await httpLoad(fixture);
  // Shares the same ephemeral Order journey and live NestJS/HTTPS services.
  // Kept after the existing HTTP burst to force a realistic 50+ event backlog.
  const currentVisitToken = await fixture.rotate();
  await require("./g4-sse-qualification.cjs")({
    db, merchant, customer, orderScope, productId: fixture.productId,
    currentVisitToken,
  });
  await require("./g4-readiness.cjs")();
}

(async () => {
  try {
    await main();
    console.log("PASS: G4 customer/mobile merchant Browser E2E and HTTP burst CI");
  } catch (error) {
    console.error("G4 HTTP/browser E2E FAILED:", error?.stack ?? String(error));
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => undefined);
    for (const child of children.reverse()) {
      child.process.kill("SIGTERM");
    }
    await db.end();
  }
})();
