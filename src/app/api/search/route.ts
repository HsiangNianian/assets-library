import { errorResponse, AppError } from "@/server/errors";
import { searchAssetsByDescription } from "@/server/repositories/assets";
import { semanticSearchEnabled } from "@/server/search/chroma";
import { descriptionSearchSchema } from "@/shared/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!semanticSearchEnabled()) {
      throw new AppError("model_not_configured", "语义检索尚未配置。", 503);
    }
    const input = descriptionSearchSchema.parse(await request.json());
    return Response.json({ items: await searchAssetsByDescription(input) });
  } catch (error) {
    return errorResponse(error);
  }
}
