import { parseUuid, withApiV1 } from "@/server/api/handler";
import { getApiV1Service } from "@/server/api/v1/service";
import { scopeFromRequest } from "@/server/api/v1/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  const { assetId: rawAssetId } = await context.params;
  return withApiV1(request, () =>
    getApiV1Service().getThumbnail(
      parseUuid(rawAssetId, "asset_id"),
      scopeFromRequest(request),
      request,
    ),
  );
}
