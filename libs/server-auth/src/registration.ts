/** Validate and normalize a merchant email address; no I/O or provider assumptions. */
export function normalizeRegistrationEmail(input: unknown): string {
  if (typeof input !== "string") throw new Error("Invalid account email");
  const email = input.trim().toLowerCase();
  if (
    email.length < 3 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error("Invalid account email");
  }
  return email;
}
