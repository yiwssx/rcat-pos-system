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
    await page.getByRole('link', {name:/Sign in with Google/}).waitFor();
    // Login: genuine Helm CTA, original OAuth entry and Google trademark colors.
    for (const viewport of [
      { width: 320, height: 780, name: 'mobile' },
      { width: 1365, height: 900, name: 'desktop' },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const login = page.getByRole('link', { name: 'Sign in with Google' });
      assert.equal(await login.getAttribute('href'), '/api/auth/google/start');
      assert.equal(await login.getAttribute('data-slot'), 'button',
        'Google OAuth must use real Spartan Helm Button without custom styling');
      assert.equal(await login.locator('svg path').count(), 4,
        'Four-color Google G artwork must remain intact');
      const appearance = await login.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          bg: style.backgroundColor,
          fg: style.color,
          height: element.getBoundingClientRect().height,
          width: document.documentElement.scrollWidth,
          viewport: document.documentElement.clientWidth,
        };
      });
      assert.equal(appearance.bg, 'rgb(255, 255, 255)', 'Google login remains white');
      assert.ok(appearance.height >= 44, 'Accessible Login target must be >=44px');
      assert.ok(appearance.width <= appearance.viewport + 1,
        'Login must not overflow viewport ' + viewport.width);
      await page.screenshot({ path: '/tmp/rcat-portal-login-' + viewport.name + '.png', fullPage: true });
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
    // Actual generated Spartan Card/Badge/Button, not the old V6 CSS widgets.
    const staffHome = page.locator('section[aria-label="พื้นที่ทำงานร้านค้า"]');
    const storeCard = staffHome.locator('[data-slot="card"]').filter({
      has: page.getByRole('heading', { name: 'RCAT Cafe', exact: true })
    });
    assert.equal(await storeCard.count(), 1, 'Seeded store must use official Spartan Helm Card');
    assert.equal(await storeCard.locator('[data-slot="badge"]').count(), 1,
      'Store role must use official Spartan Helm Badge');
    assert.equal(await storeCard.locator('a[data-slot="button"]', { hasText: 'เปิดกระดานออเดอร์' }).count(), 1,
      'Merchant Order Board remains the primary action');
    const primaryOrderAction = storeCard.locator('a[data-slot="button"]', {
      hasText: 'เปิดกระดานออเดอร์'
    });
    assert.equal(await primaryOrderAction.evaluate(el => getComputedStyle(el).textDecorationLine), 'none',
      'Spartan Order action must not inherit underlined hyperlink styling');
    const managementDisclosure = storeCard.locator('details');
    assert.equal(await managementDisclosure.evaluate(el => el.open), false,
      'Less-frequent management actions must start collapsed on mobile');
    await managementDisclosure.locator('summary').click();
    assert.equal(await managementDisclosure.evaluate(el => el.open), true,
      'Owner can reveal all prior management routes');
    await storeCard.getByRole('link', { name: 'เมนูและราคา' }).waitFor();
    await storeCard.getByRole('link', { name: 'พนักงานและสิทธิ์' }).waitFor();
    await managementDisclosure.locator('summary').click();
    const thaiFontResponse = await context.request.get(merchant + '/fonts/IBMPlexSansThai-Regular.ttf');
    assert.equal(thaiFontResponse.status(), 200, 'Self-hosted Thai font must be served by the app');
    const fontReport = await page.evaluate(async () => {
      await document.fonts.load('400 16px "RCAT Plex Thai"');
      await document.fonts.load('700 20px "RCAT Plex Thai"');
      return {
        actual: getComputedStyle(document.body).fontFamily,
        loadedRegular: document.fonts.check('400 16px "RCAT Plex Thai"'),
        loadedBold: document.fonts.check('700 20px "RCAT Plex Thai"'),
      };
    });
    assert.ok(fontReport.actual.includes('RCAT Plex Thai') && fontReport.loadedRegular && fontReport.loadedBold,
      'Self-hosted Thai/Latin typography must load at 400 and 700');
    await page.setViewportSize({ width: 1365, height: 900 });
    const desktopNav = page.getByRole('complementary', { name: 'พื้นที่ทำงาน' });
    await desktopNav.waitFor({ state: 'visible' });
    await desktopNav.getByRole('navigation', { name: 'งานของร้าน' }).waitFor();
    assert.equal(await desktopNav.getByRole('link', { name: 'พื้นที่ทำงาน' })
      .evaluate(el => getComputedStyle(el).textDecorationLine), 'none',
      'Desktop navigation must not display browser-default link underlines');
    // The mobile Sheet host must not occupy the second desktop grid cell,
    // pushing the work area into a long, narrow row beneath the sidebar.
    const desktopLayout = await page.evaluate(() => {
      const aside = document.querySelector('rcat-root aside[aria-label="พื้นที่ทำงาน"]').getBoundingClientRect();
      const main = document.querySelector('rcat-root main').getBoundingClientRect();
      return { asideRight: aside.right, mainLeft: main.left, mainTop: main.top };
    });
    assert.ok(desktopLayout.mainLeft >= desktopLayout.asideRight - 1,
      'Desktop work area must be beside the sidebar');
    assert.ok(desktopLayout.mainTop < 160,
      'Desktop work area must start on the same row as the sidebar');
    assert.equal(await desktopNav.locator('hlm-native-select [data-slot="native-select"]').count(), 1,
      'Desktop store picker must be the official Spartan Helm NativeSelect');
    const shell = await desktopNav.evaluate(element => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, image: style.backgroundImage };
    });
    assert.equal(shell.background, 'rgb(255, 253, 250)',
      'Desktop sidebar must use the V7 ivory surface');
    assert.equal(shell.image, 'none',
      'Legacy V6 orange gradient decoration must be removed from the sidebar');
    await page.setViewportSize({ width: 320, height: 780 });
    const officialLogo = page.getByRole('link', { name: 'RCAT POS หน้าแรก' }).locator('img');
    await officialLogo.waitFor();
    assert.equal(await officialLogo.evaluate(img => img.complete && img.naturalWidth === 96), true,
      'RCAT POS logo must load as an actual image');
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
      assert.ok(size.content <= size.width + 1,
        'Staff portal must not overflow ' + viewport.width + 'px');
      if (viewport.width === 320) {
        assert.equal(await page.locator('header a[aria-label="RCAT POS หน้าแรก"] strong')
          .evaluate(el => getComputedStyle(el).display), 'none',
          '320px header should use the accessible brand icon without wrapping');
      }
      await page.screenshot({ path: '/tmp/rcat-portal-' + viewport.name + '.png', fullPage: true });
      const menuButton = page.getByRole('button', { name: 'เปิดเมนูจัดการร้าน' });
      assert.equal(await menuButton.isVisible(), viewport.width < 1024,
        'Mobile Sheet toggle must replace the old horizontal scroll navigation');
      assert.equal(await desktopNav.isVisible(), viewport.width >= 1024,
        'Desktop sidebar visibility must follow responsive breakpoint');
    }
    await page.setViewportSize({ width: 320, height: 780 });
    // CDK correctly hides background controls from the accessibility tree
    // while the modal Sheet is open. Use a stable DOM locator for state checks.
    await page.getByRole('button', { name: 'เปิดเมนูจัดการร้าน' }).waitFor();
    const menuToggle = page.locator('button[aria-label="เปิดเมนูจัดการร้าน"]');
    assert.equal(await menuToggle.getAttribute('aria-expanded'), 'false');
    await menuToggle.click();
    const mobileSheet = page.locator('hlm-sheet-content[data-slot="sheet-content"]');
    await mobileSheet.waitFor({ state: 'visible' });
    await mobileSheet.getByRole('navigation', { name: 'งานของร้าน' }).waitFor();
    assert.equal(await menuToggle.getAttribute('aria-expanded'), 'true');
    await mobileSheet.getByRole('button', { name: 'ปิดเมนู' }).click();
    await mobileSheet.waitFor({ state: 'hidden' });
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
      getComputedStyle(document.querySelector('rcat-root main'), '::after').content);
    assert.equal(noDecoration, 'none', 'Do not apply homepage ornaments to actual Admin tasks');
    await adminPage.locator('.owner-stores').getByRole('link', { name: 'จัดการบุคลากรและคำเชิญ' }).waitFor();
    const createDisclosure = adminPage.locator('details.v6-owner-disclosure').first();
    assert.equal(await createDisclosure.evaluate(el => el.open), false,
      'Owner creation form stays collapsed until the user requests it');
    await createDisclosure.locator('summary').click();
    assert.equal(await createDisclosure.evaluate(el => el.open), true,
      'Owner can expand the native keyboard-accessible creation form');
    await createDisclosure.locator('summary').click();
    await adminPage.evaluate(() => window.scrollTo(0, 0));
    await adminPage.screenshot({ path: '/tmp/rcat-portal-owner-mobile.png', fullPage: true });
    await adminPage.setViewportSize({ width: 1365, height: 900 });
    await adminPage.evaluate(() => window.scrollTo(0, 0));
    await adminPage.screenshot({ path: '/tmp/rcat-portal-owner-desktop.png' });
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
    assert.equal(guestPalette.active, 'rgb(24, 107, 96)', 'Guest category selection uses V7 deep teal');
    assert.equal(guestPalette.cta, 'rgb(24, 107, 96)', 'Guest add-to-cart uses V7 deep teal');
    // The desktop filter is one compact rail, not a full-width stacked form.
    await staticPage.setViewportSize({ width: 1365, height: 900 });
    const filterSize = await staticPage.evaluate(() => {
      const rail = document.querySelector('.v6-guest-filters').getBoundingClientRect();
      const field = document.querySelector('#guest-menu-search').getBoundingClientRect();
      return { railHeight: rail.height, fieldWidth: field.width };
    });
    assert.ok(filterSize.railHeight < 85, 'Desktop search/categories should use one compact row');
    assert.ok(filterSize.fieldWidth < 460, 'Desktop search should not occupy the entire screen');
    assert.equal(await staticPage.getByRole('heading', { name: 'ตะกร้าของคุณ' }).isVisible(), true,
      'V7 desktop shows the cart summary beside the catalog');
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
    assert.equal(guestLight.background, 'rgb(255, 245, 233)', 'Guest must use the V7 warm cream canvas');
    assert.equal(guestLight.cart, 'rgb(24, 107, 96)', 'V7 cart bar uses deep teal, not orange');
    assert.equal(guestLight.label, 'rgb(255, 255, 255)', 'Cart count must use readable light text on teal');
    assert.equal(guestLight.ctaText, 'rgb(255, 255, 255)', 'Cart action must have readable white text');
    assert.equal(await staticPage.getByRole('heading', { name: 'ตะกร้าของคุณ' }).isVisible(), false,
      'V7 mobile hides the desktop cart summary');
    await staticPage.screenshot({ path: '/tmp/rcat-portal-guest-ios-cart-bar-phone.png', fullPage: true });
    await staticPage.getByRole('button', { name: 'ดูตะกร้า' }).click();
    // CDK dialog accessibility container is zero-sized by design.
    // Verify its accessible title and the actual visible Spartan Sheet surface.
    const cartDialogHost = staticPage.locator('cdk-dialog-container[role="dialog"]');
    await cartDialogHost.waitFor({ state: 'attached' });
    const cartTitleId = await cartDialogHost.getAttribute('aria-labelledby');
    assert.ok(cartTitleId, 'Spartan cart must retain an accessible title relationship');
    assert.equal((await staticPage.locator('[id="' + cartTitleId + '"]').textContent()).trim(),
      'ตะกร้าของฉัน', 'CDK dialog must reference the real Thai cart title');
    const cartSurface = staticPage.locator('hlm-sheet-content[data-slot="sheet-content"]')
      .filter({ has: staticPage.getByText('ตะกร้าของฉัน', { exact: true }) });
    await cartSurface.waitFor({ state: 'visible' });
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

    // The same printed QR remains valid, but a revoked grant must not
    // automatically join a new table cycle or replay an old cart.
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
    await staticPage.getByRole('heading', { name: 'รอบการสั่งเดิมสิ้นสุดแล้ว' }).waitFor();
    assert.equal(reconnectOpens, 0, 'Revoked grant must never silently reconnect');
    assert.equal(await staticPage.locator('.guest-product').count(), 0,
      'Revoked grant must not retain a stale menu');
    assert.equal(await staticPage.locator('.guest-cart-shortcut').count(), 0,
      'Revoked grant must not retain a stale checkout');
    await staticPage.reload();
    await staticPage.getByRole('heading', { name: 'รอบการสั่งเดิมสิ้นสุดแล้ว' }).waitFor();
    assert.equal(reconnectOpens, 0, 'Reload must not silently redeem a new grant');
    await staticPage.screenshot({ path: '/tmp/rcat-portal-guest-qr-reconnect-phone.png', fullPage: true });
    await staticPage.getByRole('button', { name: 'ยืนยันเริ่มรอบการสั่งใหม่' }).click();
    await staticPage.locator('.guest-product').first().waitFor();
    assert.equal(reconnectOpens, 1, 'Exactly one explicit new-entry action');
    assert.equal(await staticPage.locator('.guest-cart-shortcut').count(), 0,
      'Manual recovery must begin with an empty cart');
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
    await board.evaluate(() => window.scrollTo(0, 0));
    await board.screenshot({ path: '/tmp/rcat-portal-orders-mobile.png' });
    await board.setViewportSize({ width: 1365, height: 900 });
    await board.evaluate(() => window.scrollTo(0, 0));
    await board.screenshot({ path: '/tmp/rcat-portal-orders-desktop.png' });

    // Reuse this authenticated, synthetic CI fixture to capture actual
    // management screens; no new service, database or payment checks.
    for (const management of [
      { route: 'catalog', title: 'จัดการเมนูและสินค้า', ready: 'summary:has-text("เพิ่มหมวดหมู่หรือสินค้าใหม่")', file: 'catalog-desktop' },
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
      if (management.route === 'inventory') {
        const task = capture.locator('details[aria-labelledby="add-ingredient-heading"]');
        assert.equal(await task.evaluate(el => el.open), false, 'Inventory task is collapsed by default');
        await task.locator('summary').click();
        assert.equal(await task.evaluate(el => el.open), true, 'Inventory task is expandable');
        await task.getByRole('textbox', { name: 'ชื่อวัตถุดิบ' }).waitFor();
        await task.locator('summary').click();
      }
      await capture.evaluate(() => window.scrollTo(0, 0));
      await capture.screenshot({ path: '/tmp/rcat-portal-' + management.file + '.png', fullPage: true });
      await capture.setViewportSize({ width: 390, height: 844 });
      await capture.evaluate(() => window.scrollTo(0, 0));
      await capture.screenshot({ path: '/tmp/rcat-portal-' + management.route + '-mobile.png' });
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
    assert.equal(await board.getByRole('link',{name:/Sign in with Google/}).count(),0);
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
    await board.getByRole('link',{name:/Sign in with Google/}).waitFor();
    await board.goto(merchant + `/orders/${tenant}/${store}`);
    await board.getByRole('link',{name:/Sign in with Google/}).waitFor();
    await board.waitForURL(merchant + '/');
    assert.equal(new URL(board.url()).pathname,'/');
    // A failed auth service is an error/retry state, not a misleading login form.
    await board.route('**/api/auth/me', route => route.fulfill({status:503,json:{message:'unavailable'}}));
    await board.reload();
    await board.getByRole('heading',{name:'ยังเชื่อมต่อระบบไม่ได้'}).waitFor();
    assert.equal(await board.getByRole('link',{name:/Sign in with Google/}).count(),0);
    await board.unroute('**/api/auth/me');
    await board.getByRole('button',{name:'ลองเชื่อมต่ออีกครั้ง'}).click();
    await board.getByRole('link',{name:/Sign in with Google/}).waitFor();
    await context.close();
    console.log('PASS: single-origin portal, role menus/route denial, Secure login/logout, multi-viewport UI evidence, deep-link reload, auth failure/retry, Guest→Order→Merchant, CSRF denial and repeat launch');
  } finally { await browser.close(); }
}
main().catch(error => {
  // Do not print request payloads, passwords, guest bearers or expanded config.
  console.error(error.message);
  process.exitCode = 1;
});
