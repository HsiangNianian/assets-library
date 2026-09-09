import { apiV1Path } from "@/lib/paths";
import { parseJson, withApiV1 } from "@/server/api/handler";
import { getApiV1Service } from "@/server/api/v1/service";
import { compatibilityMatchRequestSchema } from "@/shared/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only builds callback material URLs; never use this value for auth or CSRF checks.
 * Set PUBLIC_BASE_URL to the external HTTP(S) URL behind a reverse proxy.
 * Forwarded headers are client-controlled and deliberately ignored.
 */
function publicRequestOrigin(request: Request) {
  const configuredBaseUrl = process.env.PUBLIC_BASE_URL?.trim();
  if (!configuredBaseUrl) return new URL(request.url).origin;

  const url = new URL(configuredBaseUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("PUBLIC_BASE_URL must be an HTTP(S) URL without credentials.");
  }
  return url.origin;
}

/** 兼容旧剪辑业务：异步对齐 ASR/LLM 分段、匹配素材并投递 camelCase 回调。 */
export async function POST(request: Request) {
  return withApiV1(request, async () => {
    const input = await parseJson(request, compatibilityMatchRequestSchema);
    const accepted = await getApiV1Service().createCompatibilityMatchTask(
      input,
      publicRequestOrigin(request),
    );
    return Response.json(accepted, {
      status: 202,
      headers: {
        location: apiV1Path(`/tasks/${accepted.taskId}`),
        "cache-control": "no-store",
      },
    });
  });
}
