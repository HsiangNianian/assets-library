import Link from "next/link";
import { ArrowRight, Images, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AssetOverviewGrid } from "@/components/asset-overview-grid";
import { listAssets } from "@/server/repositories/assets";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string | string[] }>;
}) {
  const parameters = await searchParams;
  const rawTagQuery = Array.isArray(parameters.tag)
    ? parameters.tag[0]
    : parameters.tag;
  const tagQuery = rawTagQuery?.trim().slice(0, 128) ?? "";
  const page = listAssets(undefined, 24, tagQuery);
  return (
    <main className="mx-auto max-w-7xl px-5 py-10">
      <section className="mb-9 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-sm font-semibold tracking-wide text-cyan-700">
            ASSET LIBRARY
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            素材概览
          </h1>
          <p className="mt-3 max-w-2xl text-slate-600">
            上传成功的素材会立即出现在这里，可查看处理状态并完成入库。
          </p>
        </div>
        <Button asChild size="lg">
          <Link href="/upload">
            添加新素材 <ArrowRight className="size-4" />
          </Link>
        </Button>
      </section>

      <Card className="mb-7">
        <CardContent className="pt-6">
          <form
            action="/"
            method="get"
            className="flex flex-col gap-3 sm:flex-row"
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                name="tag"
                defaultValue={tagQuery}
                maxLength={128}
                className="pl-9"
                aria-label="按标签搜索素材"
                placeholder="输入标签搜索，例如：海报、室内、简洁"
              />
            </div>
            <Button type="submit">
              <Search className="size-4" />
              搜索标签
            </Button>
            {tagQuery && (
              <Button asChild variant="outline">
                <Link href="/">
                  <X className="size-4" />
                  清除
                </Link>
              </Button>
            )}
          </form>
          <p className="mt-3 text-xs text-slate-500">
            仅匹配标签内容，不搜索素材名称或描述。
          </p>
        </CardContent>
      </Card>

      {page.items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex min-h-80 flex-col items-center justify-center text-center">
            <span className="mb-5 grid size-16 place-items-center rounded-2xl bg-cyan-50 text-cyan-700">
              <Images className="size-8" />
            </span>
            <h2 className="text-xl font-semibold">
              {tagQuery ? "未找到匹配标签的素材" : "素材库还是空的"}
            </h2>
            <p className="mt-2 max-w-md text-sm text-slate-500">
              {tagQuery
                ? `没有素材的标签包含“${tagQuery}”。`
                : "上传第一份 JPEG、PNG、WebP 图片或 H.264 MP4 视频后，即可在这里跟踪处理状态。"}
            </p>
            {tagQuery ? (
              <Button asChild variant="outline" className="mt-6">
                <Link href="/">清除搜索条件</Link>
              </Button>
            ) : (
              <Button asChild className="mt-6">
                <Link href="/upload">开始上传</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <AssetOverviewGrid assets={page.items} />
      )}
    </main>
  );
}
