import { AssetEditor } from "./asset-editor";
import { getAssetDetail } from "@/server/repositories/assets";

export const dynamic = "force-dynamic";

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const asset = getAssetDetail(id);
  return (
    <main className="mx-auto max-w-7xl px-5 py-10">
      <AssetEditor initialAsset={asset} />
    </main>
  );
}
