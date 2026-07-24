import Link from "next/link";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Images,
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
) {
  const parameters = new URLSearchParams({ view, page: String(page) });
  if (view === "published" && tagQuery) parameters.set("tag", tagQuery);
  return `/?${parameters.toString()}`;
}

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
  }>;
}) {
  const parameters = await searchParams;
  const view: AssetOverviewView =
    firstParameter(parameters.view) === "published" ? "published" : "pending";
  const requestedPage = Number.parseInt(firstParameter(parameters.page) ?? "1", 10);
  const tagQuery =
    view === "published"
      ? firstParameter(parameters.tag)?.trim().slice(0, 128) ?? ""
      : "";
  const page = listAssets({
    view,
    page: Number.isNaN(requestedPage) ? 1 : requestedPage,
    limit: 8,
    tagQuery,
  });
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

      <div className="mb-7 flex flex-col gap-4">
        <nav className="flex w-fit rounded-xl border border-slate-200 bg-white p-1">
          <Button
            asChild
            variant={view === "pending" ? "default" : "ghost"}
          >
            <Link href={overviewHref("pending", 1)}>待入库</Link>
          </Button>
          <Button
            asChild
            variant={view === "published" ? "default" : "ghost"}
          >
            <Link href={overviewHref("published", 1)}>已入库</Link>
          </Button>
        </nav>

        {view === "published" && (
          <Card>
            <CardContent className="pt-6">
              <form
                action="/"
                method="get"
                className="flex flex-col gap-3 sm:flex-row"
              >
                <input type="hidden" name="view" value="published" />
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    name="tag"
                    defaultValue={tagQuery}
                    maxLength={128}
                    className="pl-9"
                    aria-label="按标签搜索已入库素材"
                    placeholder="输入标签搜索，例如：海报、室内、简洁"
                  />
                </div>
                <Button type="submit">
                  <Search className="size-4" />
                  搜索标签
                </Button>
                {tagQuery && (
                  <Button asChild variant="outline">
                    <Link href={overviewHref("published", 1)}>
                      <X className="size-4" />
                      清除
                    </Link>
                  </Button>
                )}
              </form>
              <p className="mt-3 text-xs text-slate-500">
                仅搜索已入库素材的标签，不匹配素材名称或描述。
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">
            {view === "pending" ? "待入库素材" : "已入库素材"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {view === "pending"
              ? "包含等待解析、解析中、解析失败和解析完成待确认的素材。"
              : tagQuery
                ? `标签包含“${tagQuery}”的已入库素材。`
                : "已经完成审核并正式入库的素材。"}
          </p>
        </div>
        <span className="shrink-0 text-sm text-slate-500">
          共 {page.total} 条
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
                ? `没有已入库素材的标签包含“${tagQuery}”。`
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
        <AssetOverviewGrid assets={page.items} />
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
              href={overviewHref(view, Math.max(1, page.page - 1), tagQuery)}
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
                <Link href={overviewHref(view, item, tagQuery)}>{item}</Link>
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
