import { Pool } from "pg";
import { hashPassword } from "../../libs/server-auth/src/credentials";
import { normalizeRegistrationEmail } from "../../libs/server-auth/src/registration";

async function passwordFromPipe(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error("Pipe a password through stdin; never pass it as a CLI argument");
  }
  let value = "";
  for await (const chunk of process.stdin) {
    value += String(chunk);
    if (Buffer.byteLength(value, "utf8") > 1200) {
      throw new Error("Password input too long");
    }
  }
  return value.replace(/\r?\n$/, "");
}

async function main(): Promise<void> {
  if (process.argv.length !== 4 || process.argv[2] !== "--email") {
    throw new Error("Usage: provision-account.ts --email address (password from stdin)");
  }
  const email = normalizeRegistrationEmail(process.argv[3]);
  const host = process.env["PGHOST"];
  const database = process.env["PGDATABASE"];
  const user = process.env["PGUSER"];
  const password = process.env["PGPASSWORD"];
  const ciOnly =
    process.env["CI"] === "true" &&
    database === "rcat_ci_test" &&
    user === "postgres";
  const devOnly =
    process.env["NODE_ENV"] !== "production" &&
    database === "rcat_pos_dev" &&
    user === "rcat_dev_admin";
  if (
    process.env["NODE_ENV"] === "production" ||
    (host !== "localhost" && host !== "127.0.0.1") ||
    (!ciOnly && !devOnly) ||
    !password
  ) {
    throw new Error("Operator provisioning only supports local dev or isolated CI");
  }

  const plain = await passwordFromPipe();
  const encoded = await hashPassword(plain);
  const pool = new Pool({
    host,
    port: Number(process.env["PGPORT"] ?? 5432),
    database,
    user,
    password,
    max: 1,
  });
  try {
    const result = await pool.query<{ id: string }>(
      "INSERT INTO rcat.users(email,password_hash) VALUES($1,$2) RETURNING id",
      [email, encoded],
    );
    console.log("Provisioned development account:", result.rows[0]?.id);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : undefined;
  console.error(code === "23505" ? "Account already exists" : "Provisioning failed");
  process.exitCode = 1;
});
