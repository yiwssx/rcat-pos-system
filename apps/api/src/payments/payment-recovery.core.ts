import { BadRequestException } from "@nestjs/common";

export function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BadRequestException("Invalid payment recovery request");
  }
  return raw as Record<string, unknown>;
}

export function validateRecoveryIssue(raw: unknown): {
  expectedState: "not_requested" | "awaiting_payment";
  expectedAmountSatang: number;
} {
  const data = record(raw);
  const state = data["expectedState"];
  const amount = data["expectedAmountSatang"];
  if (
    Object.keys(data).sort().join(",") !==
      "expectedAmountSatang,expectedState,reviewed" ||
    data["reviewed"] !== true ||
    (state !== "not_requested" && state !== "awaiting_payment") ||
    typeof amount !== "number" ||
    !Number.isSafeInteger(amount) ||
    amount < 1 ||
    amount > 100_000_000
  ) {
    throw new BadRequestException(
      "Explicit outstanding payment review required",
    );
  }
  return { expectedState: state, expectedAmountSatang: amount };
}
