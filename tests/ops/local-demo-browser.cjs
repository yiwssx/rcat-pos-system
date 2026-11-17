// Runs only against the fixed ephemeral Local Compose stack in packaging CI.
const assert = require('node:assert/strict');
// Compose intentionally publishes on IPv4 loopback only; keep the CI browser and
// Node HTTP checks on that same interface without broadening host exposure.
require('node:dns').setDefaultResultOrder('ipv4first');
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
if (process.env.CI !== 'true') throw new Error('Local Compose browser qualification is CI-only');

const merchant = 'https://localhost:11880';
const customer = 'https://localhost:11880';
const admin = 'https://localhost:11880';
const tenant = '70000000-0000-4000-8000-000000000001';
const store = '70000000-0000-4000-8000-000000000002';
const password = readFileSync('.secrets/local-demo/admin-password', 'utf8').trim();
async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors', '--host-resolver-rules=MAP localhost 127.0.0.1'] });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 320, height: 780 } });
    const page = await context.newPage();
    const alias = await fetch(merchant + '/local', {redirect:'manual'});
    assert.equal(alias.status,302);
    assert.equal(alias.headers.get('location'),'/');
    await page.goto(merchant + '/local');
    await page.getByRole('link', {name:/เข้าสู่ระบบด้วยบัญชี Google/}).waitFor();
    // Guard the real bug: the inline QR eyebrow previously appeared beside
    // the logo as a displaced block rather than beneath the brand lockup.
    for (const viewport of [
      { width: 320, height: 780, name: 'mobile' },
      { width: 1365, height: 900, name: 'desktop' },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const label = page.locator('.portal-landing-intro > .portal-eyebrow');
      await label.waitFor();
      const geometry = await page.evaluate(() => {
        const logo = document.querySelector('.portal-hero-brand').getBoundingClientRect();
        const tag = document.querySelector('.portal-landing-intro > .portal-eyebrow').getBoundingClientRect();
        return {
          logoBottom: logo.bottom,
          tagTop: tag.top,
          tagRight: tag.right,
          viewportWidth: document.documentElement.clientWidth,
          documentWidth: document.documentElement.scrollWidth,
          background: getComputedStyle(document.querySelector('.portal-landing-intro > .portal-eyebrow')).backgroundColor,
        };
      });
      assert.ok(geometry.tagTop >= geometry.logoBottom,
        'QR label must appear BELOW the logo at ' + viewport.width + 'px');
      assert.ok(geometry.tagRight <= geometry.viewportWidth + 1,
        'QR label overflows to the right at ' + viewport.width + 'px');
      assert.ok(geometry.documentWidth <= geometry.viewportWidth + 1,
        'QR landing screen has horizontal overflow at ' + viewport.width + 'px');
      assert.equal(geometry.background, 'rgb(255, 240, 212)',
        'QR label must use the RCAT warm-orange design token treatment');
      await page.screenshot({
        path: '/tmp/rcat-portal-login-' + viewport.name + '.png',
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 320, height: 780 });
    assert.equal(await page.getByRole('textbox', {name: /อีเมลบัญชี/}).count(), 0,
      'Real portal must never display a demonstration password form');
    // The existing synthetic CI-only account remains an API test fixture.
    // The shipped staff portal always presents a real Google Workspace action.
    const badLogin = await context.request.post(merchant + '/api/auth/login', {
      headers: { Origin: merchant },
      data: { email: 'admin_demo@demo.invalid', password: 'invalid-local-password' }
    });
    assert.equal(badLogin.status(), 401, 'Invalid fixture credentials must fail');
    const fixtureLogin = await context.request.post(merchant + '/api/auth/login', {
      headers: { Origin: merchant },
      data: { email: 'admin_demo@demo.invalid', password }
    });
    assert.equal(fixtureLogin.status(), 200, 'CI fixture login must remain test-only');
    await page.reload();
    await page.getByRole('heading',{name:'เริ่มงานที่ร้าน',exact:true}).waitFor();
    const thaiFontResponse = await context.request.get(merchant + '/fonts/IBMPlexSansThai-Regular.ttf');
    assert.equal(thaiFontResponse.status(), 200, 'Self-hosted Thai font must be served by the app');
    const fontReport = await page.evaluate(async () => {
      await document.fonts.load('400 16px "RCAT Plex Thai"');
      await document.fonts.load('700 20px "RCAT Plex Thai"');
      return {
        actual: getComputedStyle(document.querySelector('.portal-layout')).fontFamily,
        loadedRegular: document.fonts.check('400 16px "RCAT Plex Thai"'),
        loadedBold: document.fonts.check('700 20px "RCAT Plex Thai"'),
      };
    });
    assert.ok(fontReport.actual.includes('RCAT Plex Thai') && fontReport.loadedRegular && fontReport.loadedBold,
      'Thai/Latin interface must use genuinely loaded 400/700 IBM Plex Sans Thai');
    // Owner-approved V6 color contract: actual computed styles, not AI mockup pixels.
    for (const name of [
      'v6-storefront.svg',
      'v6-ribbon-top.svg',
      'v6-bottom-waves.svg',
      'v6-cta-flourish.svg',
    ]) {
      const asset = await context.request.get(merchant + '/' + name);
      assert.equal(asset.status(), 200, 'Decorative Design System asset must ship: ' + name);
      const svg = await asset.text();
      assert.match(svg, /<svg\b/, 'Decorative file must be SVG, not a missing-page HTML fallback: ' + name);
    }
    await page.setViewportSize({ width: 1365, height: 900 });
    const palette = await page.evaluate(() => {
      const css = (selector) => getComputedStyle(document.querySelector(selector));
      return {
        orange: getComputedStyle(document.documentElement).getPropertyValue('--pos-orange').trim(),
        sidebar: css('.portal-sidebar').backgroundImage,
        orderAction: css('.v6-main-action').backgroundImage,
        secondary: css('.v6-secondary-action').backgroundImage,
      };
    });
    assert.equal(palette.orange, '#c94108', 'Production CSS must use the new readable vivid-orange token');
    assert.match(palette.sidebar, /linear-gradient/, 'Desktop navigation must use the vivid orange treatment');
    assert.match(palette.orderAction, /linear-gradient/, 'Order board entry must use the vivid brand CTA');
    assert.match(palette.secondary, /linear-gradient/, 'Secondary actions must have a distinct mint gradient');
    const ornament = await page.evaluate(() => {
      const shell = document.querySelector('.portal-content');
      const top = getComputedStyle(shell, '::before');
      const bottom = getComputedStyle(shell, '::after');
      const cta = getComputedStyle(document.querySelector('.v6-main-action'), '::after');
      return {
        top: top.backgroundImage,
        bottom: bottom.backgroundImage,
        bottomWidth: parseFloat(bottom.width),
        pointerEvents: bottom.pointerEvents,
        cta: cta.backgroundImage,
        main: getComputedStyle(document.querySelector('.portal-home')).backgroundColor,
        hintClearance: shell.getBoundingClientRect().bottom
          - document.querySelector('.portal-nav-hint').getBoundingClientRect().bottom,
      };
    });
    assert.match(ornament.top, /v6-ribbon-top\.svg/, 'Top gold ribbon must be mounted on the full application shell');
    assert.match(ornament.bottom, /v6-bottom-waves\.svg/, 'Wave must be rendered at shell level across sidebar and workspace');
    assert.ok(ornament.bottomWidth >= 1364, 'Shared bottom wave must span the full 1365px desktop shell');
    assert.equal(ornament.pointerEvents, 'none', 'Decorative overlays must never intercept POS clicks');
    assert.match(ornament.cta, /v6-cta-flourish\.svg/, 'Order CTA must use the shared basket flourish');
    assert.equal(ornament.main, 'rgba(0, 0, 0, 0)', 'Workspace must be transparent so shell ornaments remain visible');
    assert.ok(ornament.hintClearance > 54, 'Sidebar hint must remain readable above the golden wave crest');
    await page.setViewportSize({ width: 320, height: 780 });
    const officialLogo = page.locator('img.portal-brand-image');
    await officialLogo.waitFor();
    assert.equal(await officialLogo.evaluate(img => img.complete && img.naturalWidth === 96), true,
      'Uploaded RCAT POS artwork must load as a real image in the portal');
    // Verify the actual viewport being tested: the old check ran only after
    // changing to desktop width but mistakenly claimed 320px coverage.
    for (const viewport of [
      { width: 320, height: 780, name: 'mobile' },
      { width: 390, height: 844, name: 'phone' },
      { width: 768, height: 1024, name: 'tablet' },
      { width: 1365, height: 900, name: 'desktop' },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const size = await page.evaluate(() => ({
        width: innerWidth,
        content: document.documentElement.scrollWidth,
      }));
      assert.ok(size.content <= size.width + 1, 'Portal overflows at ' + viewport.width + 'px');
      const decor = await page.evaluate(() => {
        const wave = getComputedStyle(document.querySelector('.portal-content'), '::after');
        const ribbon = getComputedStyle(document.querySelector('.portal-content'), '::before');
        return { waveHeight: parseFloat(wave.height), waveURL: wave.backgroundImage, ribbonDisplay: ribbon.display };
      });
      assert.match(decor.waveURL, /v6-bottom-waves\.svg/, 'Branded wave must remain present at ' + viewport.width + 'px');
      assert.ok(decor.waveHeight <= (viewport.width <= 540 ? 73 : viewport.width <= 980 ? 113 : 179),
        'Wave must scale to avoid taking operational screen space at ' + viewport.width + 'px');
      if (viewport.width <= 980)
        assert.equal(decor.ribbonDisplay, 'none', 'Top ribbon must not compete with phone/tablet navigation');
      await page.screenshot({ path: '/tmp/rcat-portal-' + viewport.name + '.png', fullPage: true });
      // Portrait tablet and phones use one collapsible nav, not a 252px sidebar.
      if (viewport.width <= 980) {
        assert.equal(await page.getByRole('button', { name: 'เมนูจัดการร้าน' }).isVisible(), true);
        assert.equal(await page.getByRole('navigation', { name: 'งานของร้าน' }).isVisible(), false);
      }
    }
    await page.setViewportSize({ width: 320, height: 780 });
    const menuToggle = page.getByRole('button', { name: 'เมนูจัดการร้าน' });
    assert.equal(await menuToggle.getAttribute('aria-expanded'), 'false');
    await menuToggle.click();
    // Angular updates the signal-driven class after the click. Do not race
    // browser change detection with an instantaneous isVisible() assertion.
    await page.screenshot({ path: '/tmp/rcat-portal-mobile-navigation.png', fullPage: true });
    await page.locator('.portal-sidebar.portal-nav-open').waitFor();
    await page.getByRole('navigation', { name: 'งานของร้าน' }).waitFor({ state: 'visible' });
    assert.equal(await menuToggle.getAttribute('aria-expanded'), 'true');
    await menuToggle.click();
    await page.locator('.portal-sidebar:not(.portal-nav-open)').waitFor();
    assert.equal(await menuToggle.getAttribute('aria-expanded'), 'false');
    const cookies = await context.cookies(merchant);
    assert.ok(cookies.some(c => c.name === '__Host-rcat_session' && c.secure && c.httpOnly));
    const csrf = cookies.find(c => c.name === '__Host-rcat_csrf');
    assert.ok(csrf?.secure);

    // The very same compiled Admin app must retrieve the seeded tenant owner.
    const adminPage = await context.newPage();
    await adminPage.goto(admin + '/settings');
    await adminPage.getByRole('heading', { name: 'RCAT Cafe', exact: true }).waitFor();
    const noDecoration = await adminPage.evaluate(() =>
      getComputedStyle(document.querySelector('.portal-content'), '::after').content);
    assert.equal(noDecoration, 'none', 'Do not apply homepage ornaments to actual Admin tasks');
    await adminPage.locator('.owner-stores').getByRole('link', { name: 'จัดการบุคลากรและคำเชิญ' }).waitFor();
    const createDisclosure = adminPage.locator('details.v6-owner-disclosure').first();
    assert.equal(await createDisclosure.evaluate(el => el.open), false,
      'Owner creation form stays collapsed until the user requests it');
    await createDisclosure.locator('summary').click();
    assert.equal(await createDisclosure.evaluate(el => el.open), true,
      'Owner can expand the native keyboard-accessible creation form');
    await createDisclosure.locator('summary').click();
    await adminPage.screenshot({ path: '/tmp/rcat-portal-owner-mobile.png', fullPage: true });
    // All three local hosts retain a trusted-certificate path for Node fetch too.
    for (const origin of [customer]) {
      const ready = await fetch(origin + '/api/ready');
      assert.equal(ready.status, 200);
    }
    const denied = await context.request.post(merchant + `/api/tenants/${tenant}/stores/${store}/tables/70000000-0000-4000-8000-000000000005/issue-code`, {
      headers: { Origin: merchant }, data: {},
    });
    assert.equal(denied.status(), 403, 'Local mode must retain CSRF enforcement');

    const tableView = await context.newPage();
    await tableView.goto(merchant + `/tables/${tenant}/${store}`);
    await tableView.getByRole('heading', { name: 'เปิดรับออเดอร์ผ่าน QR' }).waitFor();
    const staticUrl = customer + `/order?tenant=${tenant}&store=${store}&table=70000000-0000-4000-8000-000000000005`;
    const guest = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
    const staticPage = await guest.newPage();
    await staticPage.goto(staticUrl);
    await staticPage.getByRole('heading', { name: 'ขออภัย ร้านยังไม่เปิดให้สั่งอาหาร' }).waitFor();
    assert.equal(await staticPage.locator('.guest-code-form').count(), 0, 'No PIN prompt for static QR');
    await tableView.getByRole('button', { name: 'เปิดรับออเดอร์', exact: true }).click();
    await tableView.getByRole('button', { name: 'ปิดรับออเดอร์', exact: true }).waitFor();
    await tableView.screenshot({ path: '/tmp/rcat-portal-tables-mobile.png', fullPage: true });
    await staticPage.getByRole('button', { name: 'ตรวจสอบอีกครั้ง' }).click();
    await staticPage.locator('.guest-product').first().waitFor();
    const guestFontLoaded = await staticPage.evaluate(async () => {
      await document.fonts.load('400 16px "RCAT Plex Thai"');
      return document.fonts.check('400 16px "RCAT Plex Thai"');
    });
    assert.equal(guestFontLoaded, true, 'Guest QR order must render with the self-hosted Thai font');
    const guestLogo = staticPage.locator('img.guest-brand-image');
    await guestLogo.waitFor();
    assert.equal(await guestLogo.evaluate(img => img.complete && img.naturalWidth === 96), true,
      'Guest QR menu must load the committed RCAT POS logo');
    assert.equal(await staticPage.locator('header.portal-header').isVisible(), false,
      'Guest ordering should not repeat the portal masthead');
    assert.equal(await staticPage.locator('header.guest-header').isVisible(), true);
    const guestPalette = await staticPage.evaluate(() => ({
      active: getComputedStyle(document.querySelector('.guest-category-chip.is-active')).backgroundColor,
      cta: getComputedStyle(document.querySelector('.guest-add')).backgroundColor,
    }));
    assert.equal(guestPalette.active, 'rgb(201, 65, 8)', 'Guest category selection uses accessible solid brand orange');
    assert.equal(guestPalette.cta, 'rgb(201, 65, 8)', 'Guest add-to-cart uses accessible solid brand orange');
    // The desktop filter is one compact rail, not a full-width stacked form.
    await staticPage.setViewportSize({ width: 1365, height: 900 });
    const filterSize = await staticPage.evaluate(() => {
      const rail = document.querySelector('.v6-guest-filters').getBoundingClientRect();
      const field = document.querySelector('#guest-menu-search').getBoundingClientRect();
      return { railHeight: rail.height, fieldWidth: field.width };
    });
    assert.ok(filterSize.railHeight < 85, 'Desktop search/categories should use one compact row');
    assert.ok(filterSize.fieldWidth < 460, 'Desktop search should not occupy the entire screen');
    assert.equal(await staticPage.getByRole('searchbox', { name: 'ค้นหาเมนู' }).count(), 1);
    await staticPage.screenshot({ path: '/tmp/rcat-portal-guest-search-desktop.png', fullPage: true });
    await staticPage.setViewportSize({ width: 390, height: 844 });
    const searchbox = staticPage.getByRole('searchbox', { name: 'ค้นหาเมนู' });
    await searchbox.fill('น้ำ');
    // Native searchbox clearing must restore the unfiltered menu.
    await searchbox.fill('');
    await staticPage.waitForFunction(() => document.querySelector('#guest-menu-search').value === '');
    await staticPage.waitForFunction(() => document.querySelectorAll('.guest-product').length === 3);
    await staticPage.screenshot({ path: '/tmp/rcat-portal-guest-menu-phone.png', fullPage: true });
    await staticPage.locator('.guest-product', { hasText: 'ข้าวผัด' }).getByRole('button', { name: 'เพิ่มลงตะกร้า' }).click();
    await staticPage.getByRole('dialog', { name: 'ข้าวผัด' }).getByRole('button', { name: /เพิ่มลงตะกร้า · ประมาณ/ }).click();
    await staticPage.locator('.guest-cart-shortcut').waitFor({ state: 'visible' });
    const guestLight = await staticPage.evaluate(() => {
      const host = document.querySelector('.guest-shell');
      const bar = document.querySelector('.guest-cart-shortcut');
      const action = document.querySelector('.guest-cart-shortcut-action');
      return {
        background: getComputedStyle(host).backgroundColor,
        cart: getComputedStyle(bar).backgroundColor,
        label: getComputedStyle(bar.querySelector('.guest-cart-shortcut-count')).color,
        cta: getComputedStyle(action).backgroundColor,
        ctaText: getComputedStyle(action).color,
      };
    });
    assert.equal(guestLight.background, 'rgb(245, 245, 247)', 'Guest must use the light neutral canvas');
    assert.match(guestLight.cart, /rgba?\(255, 255, 255/, 'Cart bar must be white, not an unreadable orange gradient');
    assert.equal(guestLight.label, 'rgb(28, 28, 30)', 'Cart count must use readable dark text');
    assert.equal(guestLight.cta, 'rgb(201, 65, 8)', 'Only cart action uses dark orange');
    assert.equal(guestLight.ctaText, 'rgb(255, 255, 255)', 'Cart action must have readable white text');
    await staticPage.screenshot({ path: '/tmp/rcat-portal-guest-ios-cart-bar-phone.png', fullPage: true });
    await staticPage.getByRole('button', { name: 'ดูตะกร้า' }).click();
    await staticPage.getByRole('dialog', { name: 'ตะกร้าของฉัน' }).waitFor();
    await staticPage.screenshot({ path: '/tmp/rcat-portal-guest-cart-phone.png', fullPage: true });
    await tableView.getByRole('button', { name: 'ปิดรับออเดอร์', exact: true }).click();
    await tableView.getByRole('button', { name: 'เปิดรับออเดอร์', exact: true }).waitFor();
    const closedCart = staticPage.getByRole('dialog', { name: 'ตะกร้าของฉัน' });
    await closedCart.getByRole('textbox', { name: /ชื่อผู้สั่ง/ }).fill('ผู้ทดสอบ');
    await closedCart.getByRole('textbox', { name: /สถานที่รับ\/ส่ง/ }).fill('อาคาร ก');
    await closedCart.getByRole('button', { name: /ยืนยันส่งคำสั่งซื้อ/ }).click();
    await staticPage.getByRole('heading', { name: 'ขออภัย ร้านยังไม่เปิดให้สั่งอาหาร' }).waitFor();
    assert.equal(await staticPage.locator('.guest-product').count(), 0, 'Merchant close blocks existing cart');
    await tableView.getByRole('button', { name: 'เปิดรับออเดอร์', exact: true }).click();
    await tableView.getByRole('button', { name: 'ปิดรับออเดอร์', exact: true }).waitFor();

    // A permanent printed QR should recover one expired read grant without
    // showing a misleading expired-QR screen or retaining the old cart.
    await staticPage.getByRole('button', { name: 'ตรวจสอบอีกครั้ง' }).click();
    await staticPage.locator('.guest-product').first().waitFor();
    await staticPage.locator('.guest-product', { hasText: 'ข้าวผัด' })
      .getByRole('button', { name: 'เพิ่มลงตะกร้า' }).click();
    await staticPage.getByRole('dialog', { name: 'ข้าวผัด' })
      .getByRole('button', { name: /เพิ่มลงตะกร้า · ประมาณ/ }).click();
    await staticPage.locator('.guest-cart-shortcut').waitFor();
    let reconnectOpens = 0;
    await staticPage.route('**/api/guest/ordering-table/open', route => {
      reconnectOpens += 1;
      return route.continue();
    });
    await staticPage.route('**/api/guest/ordering-visit/page', route =>
      route.fulfill({ status: 404, contentType: 'application/json',
        body: '{"message":"Ordering visit unavailable"}' }), { times: 1 });
    await staticPage.getByRole('searchbox', { name: 'ค้นหาเมนู' }).fill('ข้าว');
    await staticPage.getByText('เชื่อมต่อโต๊ะใหม่แล้ว ตะกร้าเดิมถูกล้างเพื่อความปลอดภัย กรุณาเลือกเมนูอีกครั้ง').waitFor();
    await staticPage.locator('.guest-product').first().waitFor();
    assert.equal(reconnectOpens, 1, 'Only one silent printed-QR reconnect is permitted');
    assert.equal(await staticPage.locator('.guest-cart-shortcut').count(), 0,
      'Recovered visit must start with an empty cart and no stale checkout');
    assert.equal(await staticPage.getByRole('heading', { name: 'รอบโต๊ะเดิมสิ้นสุดแล้ว' }).count(), 0,
      'Single expired read grant must not strand the guest on an expired-QR screen');
    await staticPage.screenshot({ path: '/tmp/rcat-portal-guest-auto-reconnect-phone.png', fullPage: true });

    // A second expired response cannot cause an unbounded regrant loop.
    // Show an actionable manual fallback; never replay the previous cart.
    await staticPage.locator('.guest-product', { hasText: 'ข้าวผัด' })
      .getByRole('button', { name: 'เพิ่มลงตะกร้า' }).click();
    await staticPage.getByRole('dialog', { name: 'ข้าวผัด' })
      .getByRole('button', { name: /เพิ่มลงตะกร้า · ประมาณ/ }).click();
    await staticPage.locator('.guest-cart-shortcut').waitFor();
    await staticPage.route('**/api/guest/ordering-visit/page', route =>
      route.fulfill({ status: 404, contentType: 'application/json',
        body: '{"message":"Ordering visit unavailable"}' }));
    await staticPage.getByRole('searchbox', { name: 'ค้นหาเมนู' }).fill('น้ำ');
    await staticPage.getByRole('heading', { name: 'รอบโต๊ะเดิมสิ้นสุดแล้ว' }).waitFor();
    assert.equal(reconnectOpens, 1, 'A subsequent failure must not auto-reconnect indefinitely');
    assert.equal(await staticPage.locator('.guest-product').count(), 0,
      'Expired visit must not show a stale menu');
    assert.equal(await staticPage.locator('.guest-cart-shortcut').count(), 0,
      'Expired visit must not offer a stale cart');
    await staticPage.screenshot({ path: '/tmp/rcat-portal-guest-qr-reconnect-phone.png', fullPage: true });
    await staticPage.unroute('**/api/guest/ordering-visit/page');
    await staticPage.getByRole('button', { name: 'ตรวจสอบและเชื่อมต่อโต๊ะใหม่' }).click();
    await staticPage.locator('.guest-product').first().waitFor();
    assert.equal(await staticPage.locator('.guest-cart-shortcut').count(), 0,
      'Manual recovery must also begin with an empty cart');
    await staticPage.setViewportSize({ width: 320, height: 780 });
    const guestWidth = await staticPage.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    assert.ok(guestWidth.content <= guestWidth.viewport + 1,
      'iOS Light Guest must not overflow 320px viewport');
    await staticPage.screenshot({ path: '/tmp/rcat-portal-guest-ios-320.png', fullPage: true });
    await guest.close();
    await tableView.close();

    // Open the fixture's table through its existing staff API, not a demo UI button.
    const tableCsrf = (await context.cookies(merchant)).find(cookie => cookie.name === '__Host-rcat_csrf')?.value;
    assert.ok(tableCsrf, 'Authenticated CI fixture must receive a CSRF cookie');
    const round = await context.request.post(merchant +
      '/api/tenants/70000000-0000-4000-8000-000000000001/stores/70000000-0000-4000-8000-000000000002/tables/70000000-0000-4000-8000-000000000005/rotate', {
        headers: { Origin: merchant, 'X-CSRF-Token': tableCsrf },
        data: {}
      });
    assert.ok(round.ok(), 'CI table round must be created using the normal staff API');
    const { orderingUrl } = await round.json();
    assert.equal(new URL(orderingUrl).origin, customer);
    await page.goto(orderingUrl);
    await page.waitForURL('**/order', { timeout: 30000 });
    const product = page.locator('.guest-product', { hasText: 'ข้าวกะเพรา' });
    await product.waitFor();
    assert.equal(new URL(page.url()).hash, '', 'Guest QR token must be scrubbed');
    assert.equal(await page.locator('.guest-product').count(), 3);
    await product.getByRole('button', { name: 'เพิ่มลงตะกร้า' }).click();
    const spicy = page.getByRole('dialog', { name: 'ข้าวกะเพรา' });
    await spicy.getByRole('textbox', { name: /หมายเหตุสำหรับเมนูนี้/ }).fill('ไม่ใส่ผัก');
    await spicy.getByRole('button', { name: /เพิ่มลงตะกร้า · ประมาณ/ }).click();
    await page.getByRole('button', { name: 'ดูตะกร้า' }).click();
    const cart = page.getByRole('dialog', { name: 'ตะกร้าของฉัน' });
    await cart.getByRole('textbox', { name: /ชื่อผู้สั่ง/ }).fill('คุณ ก');
    await cart.getByRole('textbox', { name: /สถานที่รับ\/ส่ง/ }).fill('อาคาร ข');
    await cart.getByRole('button', { name: /ยืนยันส่งคำสั่งซื้อ/ }).click();
    await page.waitForURL('**/order/track', { timeout: 20000 });
    await page.getByText('ร้านยังไม่เปิดรับชำระเงินผ่านระบบนี้').waitFor();
    const orderLabel = (await page.locator('.guest-track-id').innerText()).match(/#[0-9]{3,}/)?.[0];
    assert.ok(orderLabel, 'Customer tracking must show readable public Order number');
    const board = await context.newPage();
    await board.goto(merchant + `/orders/${tenant}/${store}`);
    const card = board.locator(`article[aria-label="ออเดอร์ ${orderLabel}"]`);
    await card.waitFor();
    await card.getByText('คุณ ก', { exact: true }).waitFor();
    await card.getByText('อาคาร ข', { exact: true }).waitFor();
    await card.getByText('ไม่ใส่ผัก').waitFor();
    await card.getByRole('button', { name: 'รับออเดอร์', exact: true }).click();
    await card.getByText('รับออเดอร์แล้ว', { exact: true }).waitFor();
    await board.screenshot({ path: '/tmp/rcat-portal-orders-mobile.png', fullPage: true });
    await board.setViewportSize({ width: 1365, height: 900 });
    await board.screenshot({ path: '/tmp/rcat-portal-orders-desktop.png', fullPage: true });

    // Reuse this authenticated, synthetic CI fixture to capture actual
    // management screens; no new service, database or payment checks.
    for (const management of [
      { route: 'catalog', title: 'จัดการเมนูและสินค้า', ready: '.catalog-create-summary', file: 'catalog-desktop' },
      { route: 'inventory', title: 'สต็อกวัตถุดิบของร้าน', ready: '.inventory-panel', file: 'inventory-desktop' },
      { route: 'reports', title: 'รายงานออเดอร์ประจำวัน', ready: '.report-kpis', file: 'reports-desktop' },
    ]) {
      const capture = await context.newPage();
      await capture.setViewportSize({ width: 1365, height: 900 });
      await capture.goto(merchant + '/' + management.route + '/' + tenant + '/' + store);
      await capture.getByRole('heading', { name: management.title, exact: true }).waitFor();
      // The heading renders before the async API response. A loading-state
      // screenshot is not evidence of a completed management workspace.
      await capture.locator(management.ready).first().waitFor({ state: 'visible', timeout: 25000 });
      await capture.screenshot({ path: '/tmp/rcat-portal-' + management.file + '.png', fullPage: true });
      await capture.close();
    }

    // Repeat the actual one-command launcher; no duplicate fixtures/password reset.
    execFileSync('bash', ['scripts/ops/local-demo.sh', 'up'], { stdio: 'pipe', timeout: 180000 });
    assert.equal(readFileSync('.secrets/local-demo/admin-password', 'utf8').trim(), password);
    await page.getByRole('button', { name: 'ตรวจสถานะล่าสุด' }).click();
    await page.locator('.guest-order-state').getByText('รับออเดอร์แล้ว').waitFor();
    await page.getByText('ร้านยังไม่เปิดรับชำระเงินผ่านระบบนี้').waitFor();

    const compose = ['--host=unix:///var/run/docker.sock', 'compose', '--env-file', '.env.local', '-p', 'rcat-pos-local', '-f', 'compose.local.yaml'];
    const output = execFileSync('docker', [...compose, 'exec', '-T', 'postgres', 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-U', 'rcat_local_dba', '-d', 'rcat_pos_local_demo', '-c',
      "SELECT (SELECT count(*) FROM rcat.users)||','||(SELECT count(*) FROM rcat.menu_products)||','||(SELECT count(*) FROM rcat.orders)||','||(SELECT count(*) FROM rcat.orders WHERE amount_satang=4500 AND status='accepted' AND payment_state='not_requested')||','||(SELECT count(*) FROM pg_roles WHERE rolname IN ('rcat_local_auth','rcat_local_tenant') AND NOT rolsuper AND NOT rolbypassrls AND NOT rolinherit);"],
      { encoding: 'utf8', env: { ...process.env, RCAT_LOCAL_RELEASE: 'local-ci' } });
    assert.equal(output.trim(), '2,3,1,1,2', 'Repeat launch duplicated/changed data or weakened runtime accounts');
    // Deep links survive reload without showing the login view while auth loads.
    await board.reload();
    await card.getByText('รับออเดอร์แล้ว', {exact:true}).waitFor();
    assert.equal(await board.getByRole('link',{name:/เข้าสู่ระบบด้วยบัญชี Google/}).count(),0);
    // Server role data determines visible navigation and guards guessed owner URLs.
    const cashier = await browser.newContext({ignoreHTTPSErrors:true});
    await cashier.addCookies(await context.cookies());
    await cashier.route('**/api/auth/merchant-stores', route => route.fulfill({json:{stores:[{tenantId:tenant,storeId:store,tenantName:'Demo',storeName:'RCAT Cafe',role:'cashier'}]}}));
    const cashierPage = await cashier.newPage();
    await cashierPage.goto(merchant + '/');
    await cashierPage.getByRole('heading',{name:'เริ่มงานที่ร้าน',exact:true}).waitFor();
    assert.equal(await cashierPage.getByRole('link',{name:'ตั้งค่าร้าน',exact:true}).count(),0);
    assert.equal(await cashierPage.getByRole('link',{name:'พนักงานและสิทธิ์',exact:true}).count(),0);
    await cashierPage.goto(merchant + '/settings');
    await cashierPage.getByText('บัญชีนี้ไม่มีสิทธิ์เข้าถึงงานหรือร้านที่เลือก',{exact:true}).waitFor();
    await cashierPage.waitForURL(merchant + '/');
    assert.equal(new URL(cashierPage.url()).pathname,'/');
    await cashier.close();
    await board.getByRole('button',{name:'ออกจากระบบ',exact:true}).click();
    await board.getByRole('link',{name:/เข้าสู่ระบบด้วยบัญชี Google/}).waitFor();
    await board.goto(merchant + `/orders/${tenant}/${store}`);
    await board.getByRole('link',{name:/เข้าสู่ระบบด้วยบัญชี Google/}).waitFor();
    await board.waitForURL(merchant + '/');
    assert.equal(new URL(board.url()).pathname,'/');
    // A failed auth service is an error/retry state, not a misleading login form.
    await board.route('**/api/auth/me', route => route.fulfill({status:503,json:{message:'unavailable'}}));
    await board.reload();
    await board.getByRole('heading',{name:'ยังเชื่อมต่อระบบไม่ได้'}).waitFor();
    assert.equal(await board.getByRole('link',{name:/เข้าสู่ระบบด้วยบัญชี Google/}).count(),0);
    await board.unroute('**/api/auth/me');
    await board.getByRole('button',{name:'ลองเชื่อมต่ออีกครั้ง'}).click();
    await board.getByRole('link',{name:/เข้าสู่ระบบด้วยบัญชี Google/}).waitFor();
    await context.close();
    console.log('PASS: single-origin portal, role menus/route denial, Secure login/logout, multi-viewport UI evidence, deep-link reload, auth failure/retry, Guest→Order→Merchant, CSRF denial and repeat launch');
  } finally { await browser.close(); }
}
main().catch(error => {
  // Do not print request payloads, passwords, guest bearers or expanded config.
  console.error(error.message);
  process.exitCode = 1;
});
