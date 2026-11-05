import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Pool, PoolClient } from "pg";

type Role = "rcat_auth" | "rcat_app";

@Injectable()
export class DatabaseAccess implements OnModuleDestroy {
  private readonly authPool?: Pool;
  private readonly tenantPool?: Pool;

  constructor() {
    // Production Google Workspace sessions require PostgreSQL too. Database
    // availability must NEVER implicitly enable the password-login endpoint.
    const developmentLogin = process.env["ENABLE_DEVELOPMENT_AUTH"] === "true";
    if (developmentLogin && process.env["NODE_ENV"] === "production") {
      throw new Error("Development authentication may not run in production");
    }
    const authUrl = process.env["AUTH_DATABASE_URL"];
    const tenantUrl = process.env["TENANT_DATABASE_URL"];
    if (!authUrl && !tenantUrl && !developmentLogin) {
      // Still expose /api/health; readiness and protected endpoints fail shut.
      return;
    }
    if (!authUrl || !tenantUrl || authUrl === tenantUrl) {
      throw new Error("Two distinct restricted PostgreSQL URLs are required");
    }
    this.authPool = new Pool({
      connectionString: authUrl, max: 4, connectionTimeoutMillis: 5000,
    });
    this.tenantPool = new Pool({
      connectionString: tenantUrl, max: 4, connectionTimeoutMillis: 5000,
    });
  }

  get enabled(): boolean {
    return !!this.authPool && !!this.tenantPool;
  }

  async readiness(): Promise<void> {
    // Validate BOTH restricted role connections and the minimal Ordering
    // schema. Never put customer data, credentials or driver errors into the
    // publicly accessible /ready response.
    const auth = await this.auth((client) =>
      client.query<{ ready: boolean }>(
        "SELECT to_regclass('rcat_private.auth_sessions') IS NOT NULL AS ready",
      ),
    );
    const orders = await this.withRole(
      "rcat_app", this.tenantPool, (client) =>
        client.query<{ ready: boolean }>(
          "SELECT to_regclass('rcat.orders') IS NOT NULL AND " +
          "to_regclass('rcat.order_outbox_events') IS NOT NULL AS ready",
        ),
    );
    if (!auth.rows[0]?.ready || !orders.rows[0]?.ready) {
      throw new ServiceUnavailableException("Database schema is unavailable");
    }
  }

  async auth<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.withRole("rcat_auth", this.authPool, fn);
  }

  async authForUser<T>(
    verifiedUserId: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.auth(async (client) => {
      await client.query("SELECT set_config('app.auth_user_id',$1,true)", [
        verifiedUserId,
      ]);
      return fn(client);
    });
  }

  async tenant<T>(
    verifiedTenantId: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.withRole("rcat_app", this.tenantPool, async (client) => {
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [
        verifiedTenantId,
      ]);
      return fn(client);
    });
  }

  private async withRole<T>(
    role: Role,
    pool: Pool | undefined,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    if (!pool)
      throw new ServiceUnavailableException("Authentication is disabled");
    const client = await pool.connect();
    let discardConnection = false;
    try {
      const identity = await client.query<{
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(
        "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      );
      const login = identity.rows[0];
      if (!login || login.rolsuper || login.rolbypassrls) {
        throw new Error("Refusing a privileged PostgreSQL connection");
      }

      await client.query("BEGIN");
      // Values are fixed application-side role literals, never user input.
      if (role === "rcat_auth") {
        await client.query("SET LOCAL ROLE rcat_auth");
      } else {
        await client.query("SET LOCAL ROLE rcat_app");
      }
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        discardConnection = true;
      }
      throw error;
    } finally {
      client.release(discardConnection);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.authPool?.end(), this.tenantPool?.end()]);
  }
}
