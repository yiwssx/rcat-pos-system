// Operator-only bootstrap for the isolated compose.local.yaml database.
// Never import this into the API or use CI's destructive fixture SQL here.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Pool } from "pg";
const require = createRequire(import.meta.url);
const { hashPassword } = require("../../dist/libs/server-auth/src/credentials.js");

if (process.env.NODE_ENV !== "development" || process.env.RCAT_POS_LOCAL_DEMO !== "true") {
  throw new Error("Local demonstration bootstrap is disabled");
}
function secret(name) {
  const value = readFileSync("/run/secrets/local_" + name, "utf8").trim();
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error("Invalid local secret file");
  return value;
}
const pool = new Pool({
  host: "postgres", port: 5432, database: "rcat_pos_local_demo",
  user: "rcat_local_dba", password: secret("dba"), max: 1,
});
const tenant = "70000000-0000-4000-8000-000000000001";
const store = "70000000-0000-4000-8000-000000000002";
const owner = "70000000-0000-4000-8000-000000000003";
const category = "70000000-0000-4000-8000-000000000004";
try {
  const db = await pool.connect();
  try {
    const identity = (await db.query("SELECT current_database() AS db, current_user AS role")).rows[0];
    if (identity.db !== "rcat_pos_local_demo" || identity.role !== "rcat_local_dba") {
      throw new Error("Unexpected database identity");
    }
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(70011880)");
    // Provision distinct NOINHERIT logins; the running API receives neither DBA
    // password nor role membership that could bypass tenant isolation.
    for (const [login, role, name] of [
      ["rcat_local_auth", "rcat_auth", "auth"],
      ["rcat_local_tenant", "rcat_app", "tenant"],
    ]) {
      const exists = await db.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [login]);
      if (!exists.rowCount) {
        // All identifiers are fixed literals; password strictly hex-validated.
        await db.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${secret(name)}'`);
        await db.query(`GRANT ${role} TO ${login}`);
      }
    }
    await db.query("CREATE TABLE IF NOT EXISTS rcat_private.local_demo_seed (version integer PRIMARY KEY)");
    const seeded = await db.query("SELECT 1 FROM rcat_private.local_demo_seed WHERE version=1");
    if (!seeded.rowCount) {
      // Refuse to add fixtures to a nonempty database with a missing marker.
      const existing = await db.query("SELECT 1 FROM rcat.users UNION ALL SELECT 1 FROM rcat.tenants LIMIT 1");
      if (existing.rowCount) throw new Error("Refusing to seed an unrecognized nonempty database");
      await db.query("INSERT INTO rcat.users(id,email,password_hash) VALUES($1,$2,$3)",
        [owner, "owner@demo.invalid", await hashPassword(secret("owner"))]);
      await db.query("INSERT INTO rcat.tenants(id,slug,display_name) VALUES($1,'local-demo','RCAT Local Demo')", [tenant]);
      await db.query("INSERT INTO rcat.tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')", [tenant, owner]);
      await db.query("INSERT INTO rcat.stores(id,tenant_id,slug,display_name) VALUES($1,$2,'demo-cafe','ร้านทดลอง RCAT')", [store, tenant]);
      await db.query("INSERT INTO rcat.menu_categories(id,tenant_id,store_id,slug,name) VALUES($1,$2,$3,'demo-menu','เมนูทดลอง')", [category, tenant, store]);
      for (const [name, price] of [["ข้าวกะเพรา", 4500], ["ข้าวผัด", 4000], ["น้ำดื่ม", 1000]]) {
        await db.query("INSERT INTO rcat.menu_products(tenant_id,store_id,category_id,name,price_satang) VALUES($1,$2,$3,$4,$5)", [tenant, store, category, name, price]);
      }
      await db.query("INSERT INTO rcat.store_tables(id,tenant_id,store_id,label) VALUES($1,$2,$3,'โต๊ะทดลอง 1')", ["70000000-0000-4000-8000-000000000005", tenant, store]);
      await db.query("INSERT INTO rcat_private.local_demo_seed VALUES(1)");
    }
    await db.query("COMMIT");
    console.log("LOCAL_DEMO_SEED_READY (existing menu, orders and password preserved)");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
} catch {
  // PostgreSQL diagnostics may include queries/credentials; do not print them.
  console.error("Local demo bootstrap failed; verify the isolated database and protected secret files");
  process.exitCode = 1;
} finally {
  await pool.end();
}
