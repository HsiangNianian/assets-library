import Link from "next/link";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Images,
  LayoutGrid,
  List,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AssetOverviewGrid } from "@/components/asset-overview-grid";
import {
  listAssets,
  type AssetOverviewView,
} from "@/server/repositories/assets";

export const dynamic = "force-dynamic";

function firstParameter(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function overviewHref(
  view: AssetOverviewView,
  page: number,
  tagQuery = "",
  layout: OverviewLayout = "gallery",
) {
  const parameters = new URLSearchParams({ view, page: String(page) });
  if (view === "published" && tagQuery) parameters.set("tag", tagQuery);
  if (layout === "list") parameters.set("layout", layout);
  return `/?${parameters.toString()}`;
}

type OverviewLayout = "gallery" | "list";

function paginationItems(current: number, total: number) {
  const pages = new Set([1, total, current - 1, current, current + 1]);
  const visible = [...pages]
    .filter((page) => page >= 1 && page <= total)
    .sort((left, right) => left - right);
  return visible.flatMap<(number | "ellipsis")>((page, index) => {
    const previous = visible[index - 1];
    return previous && page - previous > 1 ? ["ellipsis", page] : [page];
  });
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{
    tag?: string | string[];
    page?: string | string[];
    view?: string | string[];
    layout?: string | string[];
  }>;
}) {
  const parameters = await searchParams;
  const view: AssetOverviewView =
    firstParameter(parameters.view) === "pending" ? "pending" : "published";
  const layout: OverviewLayout =
    firstParameter(parameters.layout) === "list" ? "list" : "gallery";
  const requestedPage = Number.parseInt(firstParameter(parameters.page) ?? "1", 10);
  const tagQuery =
    view === "published"
      ? firstParameter(parameters.tag)?.trim().slice(0, 128) ?? ""
      : "";
  const page = await listAssets({
    view,
    page: Number.isNaN(requestedPage) ? 1 : requestedPage,
    limit: 8,
    tagQuery,
  });
  return (
    <main className="mx-auto max-w-7xl px-5 py-7 sm:py-9">
      <section className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
            素材库
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {view === "published" ? "已审核并可供使用的素材" : "等待审核或仍在处理的素材"}
          </p>
        </div>
        <Button asChild>
          <Link href="/upload">
            添加新素材 <ArrowRight className="size-4" />
          </Link>
        </Button>
      </section>

      <div className="mb-7 flex flex-col gap-3 rounded-[1.5rem] border border-black/[0.06] bg-white/70 p-3 shadow-sm backdrop-blur-xl sm:flex-row sm:items-center">
        <nav className="flex w-fit shrink-0 rounded-full bg-black/[0.05] p-1" aria-label="素材视图">
          <Button
            asChild
            variant={view === "published" ? "default" : "ghost"}
            size="sm"
          >
            <Link href={overviewHref("published", 1, tagQuery, layout)}>已入库</Link>
          </Button>
          <Button
            asChild
            variant={view === "pending" ? "default" : "ghost"}
            size="sm"
          >
            <Link href={overviewHref("pending", 1, "", layout)}>待入库</Link>
          </Button>
        </nav>

        {view === "published" ? (
          <form action="/" method="get" className="flex flex-1 items-center gap-2">
            <input type="hidden" name="view" value="published" />
            {layout === "list" && <input type="hidden" name="layout" value="list" />}
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                name="tag"
                defaultValue={tagQuery}
                maxLength={128}
                className="pl-10"
                aria-label="按标签搜索已入库素材"
                placeholder="搜索标签、场景或风格"
              />
            </div>
            <Button type="submit" size="sm" aria-label="搜索标签">
              <Search className="size-4" />
              <span className="hidden sm:inline">搜索</span>
            </Button>
            {tagQuery && (
              <Button asChild variant="ghost" size="sm" aria-label="清除搜索">
                <Link href={overviewHref("published", 1, "", layout)}>
                  <X className="size-4" />
                </Link>
              </Button>
            )}
          </form>
        ) : (
          <p className="px-2 text-sm text-slate-500">处理完成后，在这里确认并入库。</p>
        )}
        <div className="flex shrink-0 rounded-full bg-black/[0.05] p-1" aria-label="布局选择">
          <Button
            asChild
            variant={layout === "gallery" ? "default" : "ghost"}
            size="sm"
            aria-label="画廊视图"
          >
            <Link href={overviewHref(view, 1, tagQuery, "gallery")}>
              <LayoutGrid className="size-3.5" />
            </Link>
          </Button>
          <Button
            asChild
            variant={layout === "list" ? "default" : "ghost"}
            size="sm"
            aria-label="列表视图"
          >
            <Link href={overviewHref(view, 1, tagQuery, "list")}>
              <List className="size-3.5" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {view === "pending" ? "待入库素材" : "已入库素材"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {view === "pending"
              ? "包含等待解析、解析中、解析失败和解析完成待确认的素材。"
              : tagQuery
                ? `标签模糊匹配“${tagQuery}”的已入库素材。`
                : "已经完成审核并正式入库的素材。"}
          </p>
        </div>
        <span className="shrink-0 text-sm tabular-nums text-slate-500">
          {page.total} 项
        </span>
      </div>

      {page.items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex min-h-80 flex-col items-center justify-center text-center">
            <span className="mb-5 grid size-16 place-items-center rounded-2xl bg-cyan-50 text-cyan-700">
              <Images className="size-8" />
            </span>
            <h2 className="text-xl font-semibold">
              {tagQuery
                ? "未找到匹配标签的已入库素材"
                : view === "pending"
                  ? "暂无待入库素材"
                  : "暂无已入库素材"}
            </h2>
            <p className="mt-2 max-w-md text-sm text-slate-500">
              {tagQuery
                ? `没有已入库素材的标签匹配“${tagQuery}”。`
                : view === "pending"
                  ? "新上传、处理中或等待确认的素材会显示在这里。"
                  : "完成素材分析和审核入库后，即可在这里浏览。"}
            </p>
            {tagQuery ? (
              <Button asChild variant="outline" className="mt-6">
                <Link href={overviewHref("published", 1)}>清除搜索条件</Link>
              </Button>
            ) : view === "pending" ? (
              <Button asChild className="mt-6">
                <Link href="/upload">开始上传</Link>
              </Button>
            ) : (
              <Button asChild variant="outline" className="mt-6">
                <Link href={overviewHref("pending", 1)}>查看待入库素材</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <AssetOverviewGrid assets={page.items} layout={layout} />
      )}

      {page.totalPages > 1 && (
        <nav
          className="mt-8 flex flex-wrap items-center justify-center gap-2"
          aria-label="素材分页"
        >
          <Button
            asChild
            variant="outline"
            size="sm"
            className={page.page === 1 ? "pointer-events-none opacity-50" : ""}
          >
            <Link
              href={overviewHref(view, Math.max(1, page.page - 1), tagQuery, layout)}
              aria-disabled={page.page === 1}
            >
              <ChevronLeft className="size-4" />
              上一页
            </Link>
          </Button>
          {paginationItems(page.page, page.totalPages).map((item, index) =>
            item === "ellipsis" ? (
              <span
                key={`ellipsis-${index}`}
                className="px-1 text-sm text-slate-400"
              >
                …
              </span>
            ) : (
              <Button
                key={item}
                asChild
                variant={item === page.page ? "default" : "outline"}
                size="sm"
              >
                <Link href={overviewHref(view, item, tagQuery, layout)}>{item}</Link>
              </Button>
            ),
          )}
          <Button
            asChild
            variant="outline"
            size="sm"
            className={
              page.page === page.totalPages
                ? "pointer-events-none opacity-50"
                : ""
            }
          >
            <Link
              href={overviewHref(
                view,
                Math.min(page.totalPages, page.page + 1),
                tagQuery,
                layout,
              )}
              aria-disabled={page.page === page.totalPages}
            >
              下一页
              <ChevronRight className="size-4" />
            </Link>
          </Button>
        </nav>
      )}
    </main>
  );
}
