import { errorResponse } from "@/server/errors";
import { publishAsset } from "@/server/repositories/assets";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const { assetId } = await context.params;
    return Response.json(publishAsset(assetId));
  } catch (error) {
    return errorResponse(error);
  }
}
