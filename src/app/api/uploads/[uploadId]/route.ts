import { errorResponse } from "@/server/errors";
import { getUploadStatus } from "@/server/repositories/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ uploadId: string }> },
) {
  try {
    const { uploadId } = await context.params;
    return Response.json(getUploadStatus(uploadId));
  } catch (error) {
    return errorResponse(error);
  }
}
