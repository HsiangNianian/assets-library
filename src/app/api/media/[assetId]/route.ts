import { errorResponse } from "@/server/errors";
import { mediaResponse } from "@/server/media/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const { assetId } = await context.params;
    return mediaResponse(assetId, request);
  } catch (error) {
    return errorResponse(error);
  }
}
