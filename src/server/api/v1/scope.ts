import { ApiV1Error } from "@/server/api/errors";
import { userIdSchema, type UserScope } from "@/shared/contracts";

/** 详情和媒体接口不接受 all，避免单资源读取绕过归属边界。 */
export function scopeFromRequest(request: Request): UserScope {
  const url = new URL(request.url);
  const rawUserId = url.searchParams.get("user_id");
  if (rawUserId === null || rawUserId.trim() === "") return { mode: "public" };
  const parsed = userIdSchema.safeParse(rawUserId);
  if (!parsed.success) {
    throw new ApiV1Error(
      "invalid_request",
      parsed.error.issues[0]?.message ?? "user_id 无效。",
      400,
    );
  }
  return { mode: "user", user_id: parsed.data };
}
