/** Strict server-side money parsing for future Order snapshots; never parse with floats. */
export function parseThbToSatang(value: string): number {
  if (!/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.test(value)) {
    throw new Error("Invalid THB amount");
  }
  const [baht, satang = ""] = value.split(".");
  const result = BigInt(baht) * 100n + BigInt((satang + "00").slice(0, 2));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("THB amount exceeds safe integer range");
  }
  return Number(result);
}
