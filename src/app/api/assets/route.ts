import { errorResponse } from "@/server/errors";
import { listAssets } from "@/server/repositories/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const view =
      url.searchParams.get("view") === "pending" ? "pending" : "published";
    const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
    const tagQuery = url.searchParams.get("tag") ?? undefined;
    const limit = Number.parseInt(url.searchParams.get("limit") ?? "8", 10);
    return Response.json(
      await listAssets({
        view,
        page: Number.isNaN(page) ? 1 : page,
        limit: Number.isNaN(limit) ? 8 : limit,
        tagQuery,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
