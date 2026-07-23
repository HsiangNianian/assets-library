import crypto from "node:crypto";
import { loadConfig } from "@/server/config";
import { AppError } from "@/server/errors";

interface SignedPayload {
  assetId: string;
  expiresAt: number;
}

function signature(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createModelMediaToken(
  assetId: string,
  expiresAt = Date.now() + 10 * 60_000,
) {
  const config = loadConfig();
  const payload = Buffer.from(
    JSON.stringify({ assetId, expiresAt } satisfies SignedPayload),
  ).toString("base64url");
  return `${payload}.${signature(payload, config.MEDIA_SIGNING_SECRET)}`;
}

export function verifyModelMediaToken(token: string) {
  const config = loadConfig();
  const [payload, supplied] = token.split(".");
  if (!payload || !supplied) throw new AppError("invalid_request", "媒体链接无效。", 403);
  const expected = signature(payload, config.MEDIA_SIGNING_SECRET);
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    throw new AppError("invalid_request", "媒体签名无效。", 403);
  }
  const parsed = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as SignedPayload;
  if (!parsed.assetId || parsed.expiresAt < Date.now()) {
    throw new AppError("invalid_request", "媒体链接已过期。", 403);
  }
  return parsed.assetId;
}
