import { Injectable, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { Pool, PoolClient } from "pg";

type Role = "rcat_auth" | "rcat_app";

@Injectable()
export class DatabaseAccess implements OnModuleDestroy {
  private readonly authPool?: Pool;
  private readonly tenantPool?: Pool;

  constructor() {
    if (process.env["ENABLE_DEVELOPMENT_AUTH"] !== "true") {
      return;
    }
    // Development-only login endpoints until distributed rate limiting, audit,
    // account recovery and threat review are complete. Fail shut in production.
    if (process.env["NODE_ENV"] === "production") {
      throw new Error("Development authentication may not run in production");
    }
    const authUrl = process.env["AUTH_DATABASE_URL"];
    const tenantUrl = process.env["TENANT_DATABASE_URL"];
    if (!authUrl || !tenantUrl || authUrl === tenantUrl) {
      throw new Error("Two distinct restricted PostgreSQL URLs are required");
    }
    this.authPool = new Pool({ connectionString: authUrl, max: 4 });
    this.tenantPool = new Pool({ connectionString: tenantUrl, max: 4 });
  }

  get enabled(): boolean {
    return !!this.authPool && !!this.tenantPool;
  }

  async auth<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.withRole("rcat_auth", this.authPool, fn);
  }

  async authForUser<T>(
    verifiedUserId: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.auth(async (client) => {
      await client.query(
        "SELECT set_config('app.auth_user_id',$1,true)",
        [verifiedUserId],
      );
      return fn(client);
    });
  }

  async tenant<T>(
    verifiedTenantId: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.withRole("rcat_app", this.tenantPool, async (client) => {
      await client.query(
        "SELECT set_config('app.tenant_id',$1,true)",
        [verifiedTenantId],
      );
      return fn(client);
    });
  }

  private async withRole<T>(
    role: Role,
    pool: Pool | undefined,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    if (!pool) throw new ServiceUnavailableException("Authentication is disabled");
    const client = await pool.connect();
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
        // Return the original error; never re-use a broken connection.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.authPool?.end(), this.tenantPool?.end()]);
  }
}
