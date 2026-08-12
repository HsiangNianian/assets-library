import { parseUserIdPath, withApiV1 } from "@/server/api/handler";
import { getApiV1Service } from "@/server/api/v1/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  return withApiV1(request, async () => {
    const { userId } = await context.params;
    const result = await getApiV1Service().getUserStorageUsage(
      parseUserIdPath(userId),
    );
    return Response.json(result, {
      headers: { "cache-control": "no-store" },
    });
  });
}
