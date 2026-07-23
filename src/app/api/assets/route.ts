import { errorResponse } from "@/server/errors";
import { listPublishedAssets } from "@/server/repositories/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const limit = Number.parseInt(url.searchParams.get("limit") ?? "24", 10);
    return Response.json(listPublishedAssets(cursor, Number.isNaN(limit) ? 24 : limit));
  } catch (error) {
    return errorResponse(error);
  }
}
