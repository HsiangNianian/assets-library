import { errorResponse } from "@/server/errors";
import {
  getAssetDetail,
  softDeleteAsset,
  updateAssetMetadata,
} from "@/server/repositories/assets";
import { assetEditSchema } from "@/shared/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const { assetId } = await context.params;
    return Response.json(getAssetDetail(assetId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const { assetId } = await context.params;
    const edit = assetEditSchema.parse(await request.json());
    return Response.json(updateAssetMetadata(assetId, edit));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const { assetId } = await context.params;
    softDeleteAsset(assetId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
