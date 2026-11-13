// Runs only against the fixed ephemeral Local Compose stack in packaging CI.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
if (process.env.CI !== 'true') throw new Error('Local Compose browser qualification is CI-only');

const merchant = 'https://localhost:11880';
const customer = 'https://localhost:11880';
const admin = 'https://localhost:11880';
const tenant = '70000000-0000-4000-8000-000000000001';
const store = '70000000-0000-4000-8000-000000000002';
const password = readFileSync('.secrets/local-demo/owner-password', 'utf8').trim();
async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 320, height: 780 } });
    const page = await context.newPage();
    const alias = await fetch(merchant + '/local', {redirect:'manual'});
    assert.equal(alias.status,302);
    assert.equal(alias.headers.get('location'),'/');
    await page.goto(merchant + '/local');
    await page.getByRole('button', {name:'เข้าสู่ระบบทดลอง',exact:true}).waitFor();
    assert.ok(await page.getByLabel('อีเมลบัญชีทดลอง').isVisible());
    await page.getByLabel('รหัสผ่านทดลอง').fill('invalid-local-password');
    await page.getByRole('button', { name: 'เข้าสู่ระบบทดลอง', exact: true }).click();
    await page.getByRole('alert').filter({hasText:'อีเมลหรือรหัสผ่านไม่ถูกต้อง'}).waitFor();
    await page.getByLabel('รหัสผ่านทดลอง').fill(password);
    await page.getByRole('button', { name: 'เข้าสู่ระบบทดลอง', exact: true }).click();
    await page.getByRole('heading',{name:'เริ่มงานที่ร้าน',exact:true}).waitFor();
    await page.screenshot({path:'/tmp/rcat-portal-mobile.png',fullPage:true});
    await page.setViewportSize({width:1365,height:900});
    await page.screenshot({path:'/tmp/rcat-portal-desktop.png',fullPage:true});
    const size = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
    assert.ok(size.content <= size.width + 1, 'Local launcher overflows at 320px');
    const cookies = await context.cookies(merchant);
    assert.ok(cookies.some(c => c.name === '__Host-rcat_session' && c.secure && c.httpOnly));
    const csrf = cookies.find(c => c.name === '__Host-rcat_csrf');
    assert.ok(csrf?.secure);

    // The very same compiled Admin app must retrieve the seeded tenant owner.
    const adminPage = await context.newPage();
    await adminPage.goto(admin + '/settings');
    await adminPage.getByRole('heading', { name: 'ร้านทดลอง RCAT', exact: true }).waitFor();
    await adminPage.locator('.owner-stores').getByRole('link', { name: 'จัดการบุคลากรและคำเชิญ' }).waitFor();
    // All three local hosts retain a trusted-certificate path for Node fetch too.
    for (const origin of [customer]) {
      const ready = await fetch(origin + '/api/ready');
      assert.equal(ready.status, 200);
    }
    const denied = await context.request.post(merchant + `/api/tenants/${tenant}/stores/${store}/tables/70000000-0000-4000-8000-000000000005/issue-code`, {
      headers: { Origin: merchant }, data: {},
    });
    assert.equal(denied.status(), 403, 'Local mode must retain CSRF enforcement');

    await page.getByRole('button', { name: 'เปิดโต๊ะทดลองเพื่อสั่งอาหาร', exact: true }).click();
    await page.waitForURL(customer + '/order', { timeout: 30000 });
    const product = page.locator('.guest-product', { hasText: 'ข้าวกะเพรา' });
    await product.waitFor();
    assert.equal(new URL(page.url()).hash, '', 'Guest QR token must be scrubbed');
    assert.equal(await page.locator('.guest-product').count(), 3);
    await product.getByRole('button', { name: 'เพิ่มลงตะกร้า' }).click();
    await page.getByRole('button', { name: /ยืนยันส่งคำสั่งซื้อ/ }).click();
    await page.waitForURL('**/order/track', { timeout: 20000 });
    await page.getByText('Payment: not_requested').waitFor();
    const orderPrefix = (await page.locator('.guest-track-id').innerText()).match(/[a-f0-9]{8}/i)?.[0];
    assert.ok(orderPrefix);
    const board = await context.newPage();
    await board.goto(merchant + `/orders/${tenant}/${store}`);
    const card = board.locator(`article[aria-label^="ออเดอร์ ${orderPrefix}"]`);
    await card.waitFor();
    await card.getByRole('button', { name: 'รับออเดอร์', exact: true }).click();
    await card.getByText('รับออเดอร์แล้ว', { exact: true }).waitFor();

    // Repeat the actual one-command launcher; no duplicate fixtures/password reset.
    execFileSync('bash', ['scripts/ops/local-demo.sh', 'up'], { stdio: 'pipe', timeout: 180000 });
    assert.equal(readFileSync('.secrets/local-demo/owner-password', 'utf8').trim(), password);
    await page.getByRole('button', { name: 'ตรวจสถานะล่าสุด' }).click();
    await page.locator('.guest-order-state').getByText('รับออเดอร์แล้ว').waitFor();
    await page.getByText('Payment: not_requested').waitFor();

    const compose = ['--host=unix:///var/run/docker.sock', 'compose', '--env-file', '.env.local', '-p', 'rcat-pos-local', '-f', 'compose.local.yaml'];
    const output = execFileSync('docker', [...compose, 'exec', '-T', 'postgres', 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-U', 'rcat_local_dba', '-d', 'rcat_pos_local_demo', '-c',
      "SELECT (SELECT count(*) FROM rcat.users)||','||(SELECT count(*) FROM rcat.menu_products)||','||(SELECT count(*) FROM rcat.orders)||','||(SELECT count(*) FROM rcat.orders WHERE amount_satang=4500 AND status='accepted' AND payment_state='not_requested')||','||(SELECT count(*) FROM pg_roles WHERE rolname IN ('rcat_local_auth','rcat_local_tenant') AND NOT rolsuper AND NOT rolbypassrls AND NOT rolinherit);"],
      { encoding: 'utf8', env: { ...process.env, RCAT_LOCAL_RELEASE: 'local-ci' } });
    assert.equal(output.trim(), '1,3,1,1,2', 'Repeat launch duplicated/changed data or weakened runtime accounts');
    // Deep links survive reload without showing the login view while auth loads.
    await board.reload();
    await card.getByText('รับออเดอร์แล้ว', {exact:true}).waitFor();
    assert.equal(await board.getByRole('button',{name:'เข้าสู่ระบบทดลอง',exact:true}).count(),0);
    // Server role data determines visible navigation and guards guessed owner URLs.
    const cashier = await browser.newContext({ignoreHTTPSErrors:true});
    await cashier.addCookies(await context.cookies());
    await cashier.route('**/api/auth/merchant-stores', route => route.fulfill({json:{stores:[{tenantId:tenant,storeId:store,tenantName:'Demo',storeName:'ร้านทดลอง RCAT',role:'cashier'}]}}));
    const cashierPage = await cashier.newPage();
    await cashierPage.goto(merchant + '/');
    await cashierPage.getByRole('heading',{name:'เริ่มงานที่ร้าน',exact:true}).waitFor();
    assert.equal(await cashierPage.getByRole('link',{name:'ตั้งค่าร้าน',exact:true}).count(),0);
    assert.equal(await cashierPage.getByRole('link',{name:'พนักงานและสิทธิ์',exact:true}).count(),0);
    await cashierPage.goto(merchant + '/settings');
    await cashierPage.getByText('บัญชีนี้ไม่มีสิทธิ์เข้าถึงงานหรือร้านที่เลือก',{exact:true}).waitFor();
    assert.equal(new URL(cashierPage.url()).pathname,'/');
    await cashier.close();
    await board.getByRole('button',{name:'ออกจากระบบ',exact:true}).click();
    await board.getByRole('button',{name:'เข้าสู่ระบบทดลอง',exact:true}).waitFor();
    await board.goto(merchant + `/orders/${tenant}/${store}`);
    await board.getByRole('button',{name:'เข้าสู่ระบบทดลอง',exact:true}).waitFor();
    assert.equal(new URL(board.url()).pathname,'/');
    // A failed auth service is an error/retry state, not a misleading login form.
    await board.route('**/api/auth/me', route => route.fulfill({status:503,json:{message:'unavailable'}}));
    await board.reload();
    await board.getByRole('heading',{name:'ยังเชื่อมต่อระบบไม่ได้'}).waitFor();
    assert.equal(await board.getByRole('button',{name:'เข้าสู่ระบบทดลอง',exact:true}).count(),0);
    await board.unroute('**/api/auth/me');
    await board.getByRole('button',{name:'ลองเชื่อมต่ออีกครั้ง'}).click();
    await board.getByRole('button',{name:'เข้าสู่ระบบทดลอง',exact:true}).waitFor();
    await context.close();
    console.log('PASS: single-origin portal, role menus/route denial, Secure login/logout, mobile/desktop screenshots, deep-link reload, auth failure/retry, Guest→Order→Merchant, CSRF denial and repeat launch');
  } finally { await browser.close(); }
}
main().catch(error => {
  // Do not print request payloads, passwords, guest bearers or expanded config.
  console.error(error.message);
  process.exitCode = 1;
});
