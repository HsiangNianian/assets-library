import { AssetEditor } from "./asset-editor";
import { getApiV1Service } from "@/server/api/v1/service";

export const dynamic = "force-dynamic";

export default async function AssetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ user_id?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const rawUserId = Array.isArray(query.user_id) ? query.user_id[0] : query.user_id;
  const userId = rawUserId?.trim() || null;
  const asset = await getApiV1Service().getAsset(
    id,
    userId ? { mode: "user", user_id: userId } : { mode: "public" },
  );
  return (
    <main className="mx-auto max-w-7xl px-5 py-10">
      <AssetEditor initialAsset={asset} />
    </main>
  );
}
