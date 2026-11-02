/** Validate a URL-safe ASCII store slug, not the shop's Thai display name. */
export function isValidStoreSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 48 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  );
}
