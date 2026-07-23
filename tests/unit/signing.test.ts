import { beforeEach, describe, expect, it } from "vitest";
import {
  createModelMediaToken,
  verifyModelMediaToken,
} from "@/server/media/signing";

describe("model media signing", () => {
  beforeEach(() => {
    process.env.MEDIA_SIGNING_SECRET = "test-secret-at-least-16-characters";
  });

  it("round trips a valid token", () => {
    const token = createModelMediaToken("asset-1", Date.now() + 30_000);
    expect(verifyModelMediaToken(token)).toBe("asset-1");
  });

  it("rejects tampering and expiry", () => {
    const token = createModelMediaToken("asset-1", Date.now() + 30_000);
    expect(() => verifyModelMediaToken(`${token}x`)).toThrow();
    const expired = createModelMediaToken("asset-1", Date.now() - 1);
    expect(() => verifyModelMediaToken(expired)).toThrow();
  });
});
