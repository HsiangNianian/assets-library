import { errorResponse } from "@/server/errors";
import { mediaResponse } from "@/server/media/response";
import { verifyModelMediaToken } from "@/server/media/signing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await context.params;
    return mediaResponse(verifyModelMediaToken(token), request);
  } catch (error) {
    return errorResponse(error);
  }
}
