import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { assets, mediaObjects } from "@/server/db/schema";

/** 读取一个素材的缩略图对象；权限作用域仍由 API service 在调用前校验。 */
export async function getAssetThumbnailObject(assetId: string) {
  const [row] = await db
    .select({ asset: assets, object: mediaObjects })
    .from(assets)
    .innerJoin(
      mediaObjects,
      eq(mediaObjects.id, assets.thumbnailMediaObjectId),
    )
    .where(
      and(
        eq(assets.id, assetId),
        eq(assets.mediaType, "video"),
        eq(mediaObjects.status, "persisted"),
      ),
    )
    .limit(1);
  return row ?? null;
}
