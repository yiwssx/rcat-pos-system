import { describe, expect, it } from "vitest";
import { buildPromptPayPayload, thaiQrCrc } from "./promptpay-qr.core";

function tags(payload: string): Map<string, string> {
  const result = new Map<string, string>();
  let position = 0;
  while (position < payload.length) {
    const tag = payload.slice(position, position + 2);
    const len = Number(payload.slice(position + 2, position + 4));
    expect(tag).toMatch(/^[0-9]{2}$/);
    expect(Number.isInteger(len)).toBe(true);
    const value = payload.slice(position + 4, position + 4 + len);
    expect(value.length).toBe(len);
    expect(result.has(tag)).toBe(false);
    result.set(tag, value);
    position += 4 + len;
  }
  expect(position).toBe(payload.length);
  return result;
}

describe("PromptPay QR (G5-M1, no live endpoint)", () => {
  it("uses the ISO CRC16 CCITT-FALSE reference vector", () => {
    expect(thaiQrCrc("123456789")).toBe("29B1");
  });

  it("encodes personal Thai mobile into 0066 format and integer satang into 54", () => {
    const payload = buildPromptPayPayload({
      receiverKind: "mobile",
      receiverId: "0812345678",
      amountSatang: 20_005,
    });
    const root = tags(payload);
    expect(root.get("00")).toBe("01");
    expect(root.get("01")).toBe("12");
    expect(root.get("53")).toBe("764");
    expect(root.get("54")).toBe("200.05");
    expect(root.get("58")).toBe("TH");
    expect(tags(root.get("29")!).get("00")).toBe("A000000677010111");
    expect(tags(root.get("29")!).get("01")).toBe("0066812345678");
    const beforeCrc = payload.slice(0, -4);
    expect(beforeCrc.endsWith("6304")).toBe(true);
    expect(root.get("63")).toBe(thaiQrCrc(beforeCrc));
  });

  it("supports a 13-digit tax / national ID and amount upper bound", () => {
    const payload = buildPromptPayPayload({
      receiverKind: "national_id",
      receiverId: "1234567890123",
      amountSatang: 100_000_000,
    });
    const root = tags(payload);
    expect(tags(root.get("29")!).get("02")).toBe("1234567890123");
    expect(root.get("54")).toBe("1000000.00");
  });

  it("does not manufacture a unique bank reference for same recipient and amount", () => {
    const input = {receiverKind: "mobile" as const, receiverId: "0898765432", amountSatang: 9_950};
    const first = buildPromptPayPayload(input);
    const second = buildPromptPayPayload({...input});
    expect(second).toBe(first);
    expect(tags(first).has("62")).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER, 100_000_001])(
    "rejects invalid / out-of-order amount %s",
    (amountSatang) => {
      expect(() => buildPromptPayPayload({
        receiverKind: "mobile", receiverId: "0812345678", amountSatang,
      })).toThrow();
    },
  );

  it.each(["", "1234567890", "0212345678", "081234567", "08123456789", "08x2345678", "081-234-5678"])(
    "rejects invalid mobile or ordinary bank account %s", (receiverId) => {
      expect(() => buildPromptPayPayload({
        receiverKind: "mobile", receiverId, amountSatang: 100,
      })).toThrow();
    },
  );

  it("rejects unsupported recipient kind and rejects wrong length for tax ID", () => {
    expect(() => buildPromptPayPayload({
      receiverKind: "bank_account" as never,
      receiverId: "1234567890", amountSatang: 100,
    })).toThrow();
    expect(() => buildPromptPayPayload({
      receiverKind: "national_id",
      receiverId: "123456789012", amountSatang: 100,
    })).toThrow();
  });
});
