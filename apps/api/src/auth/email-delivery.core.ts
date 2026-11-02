import { createHash } from "node:crypto";

export type EmailPurpose = "verify-email" | "reset-password";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
}

export type FetchFunction = typeof fetch;

export function buildActionEmail(
  purpose: EmailPurpose,
  to: string,
  secret: string,
  baseUrl: string,
): OutgoingEmail {
  // Base URL is a trusted operator-controlled setting, never client input.
  const url = new URL(baseUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        process.env["CI"] === "true" &&
        url.origin.startsWith("http://127.0.0.1:")
      ))
  ) {
    throw new Error("An approved email action HTTPS origin is required");
  }
  const path = purpose === "verify-email" ? "verify-email" : "reset-password";
  const actionUrl = new URL(
    path,
    url.href.endsWith("/") ? url.href : url.href + "/",
  );
  // Fragment is handled by the customer-facing frontend, not sent to servers or
  // reverse-proxy access logs. Angular must remove it once read.
  actionUrl.hash = `token=${encodeURIComponent(secret)}`;
  const subject =
    purpose === "verify-email"
      ? "Verify your RCAT POS email"
      : "Reset your RCAT POS password";
  const minutes = purpose === "verify-email" ? 30 : 20;
  const text =
    `RCAT POS requested an account action.\n\nOpen this link to continue:\n${actionUrl.toString()}\n\n` +
    `This link expires in ${minutes} minutes. If you did not request it, ignore this email.\n`;
  const idempotencyKey = createHash("sha256")
    .update(purpose + ":" + to + ":" + secret)
    .digest("hex");
  return { to, subject, text, idempotencyKey };
}

export async function sendResendEmail(
  message: OutgoingEmail,
  key: string,
  from: string,
  http: FetchFunction = fetch,
): Promise<void> {
  const response = await http("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(6000),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Idempotency-Key": message.idempotencyKey,
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
    }),
    redirect: "error",
  });
  if (!response.ok) throw new Error("Mail transport unsuccessful");
}
