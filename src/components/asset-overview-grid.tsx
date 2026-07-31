"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  Send,
  X,
} from "lucide-react";
import { MediaPreview } from "@/components/media-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { AssetSummary, ProcessingStatus } from "@/shared/contracts";

const processingLabel: Record<ProcessingStatus, string> = {
  queued: "等待处理",
  validating: "校验中",
  analyzing: "分析中",
  completed: "分析完成",
  failed: "分析失败",
};

export function AssetOverviewGrid({
  assets,
  layout,
}: {
  assets: AssetSummary[];
  layout: "gallery" | "list";
}) {
  const router = useRouter();
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const hasActiveJobs = assets.some((asset) =>
    ["queued", "validating", "analyzing"].includes(asset.processingStatus),
  );
  const hasSearchScores = assets.some((asset) => asset.searchScore !== undefined);

  useEffect(() => {
    if (!hasActiveJobs) return;
    const timer = window.setInterval(() => router.refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [hasActiveJobs, router]);

  useEffect(() => {
    if (previewIndex === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewIndex(null);
      if (event.key === "ArrowLeft") {
        setPreviewIndex((index) => (index === null ? null : Math.max(0, index - 1)));
      }
      if (event.key === "ArrowRight") {
        setPreviewIndex((index) =>
          index === null ? null : Math.min(assets.length - 1, index + 1),
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [assets.length, previewIndex]);

  const publish = async (assetId: string) => {
    setPublishingId(assetId);
    setMessage("");
    try {
      const response = await fetch(`/api/assets/${assetId}/publish`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "入库失败。");
      }
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "入库失败。");
    } finally {
      setPublishingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {message && (
        <p className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="size-4" />
          {message}
        </p>
      )}
      {hasSearchScores && (
        <div className="flex items-center justify-between rounded-2xl bg-white/55 px-4 py-3 text-sm text-slate-600">
          <span>搜索结果按相关性排序</span>
          <button
            type="button"
            className="font-medium text-[#0071e3] transition-opacity hover:opacity-70"
            onClick={() => setShowDiagnostics((visible) => !visible)}
            aria-pressed={showDiagnostics}
          >
            {showDiagnostics ? "隐藏检索诊断" : "显示检索诊断"}
          </button>
        </div>
      )}
      {layout === "gallery" ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {assets.map((asset, index) => (
            <GalleryCard
              key={asset.id}
              asset={asset}
              showDiagnostics={showDiagnostics}
              publishing={publishingId === asset.id}
              onPreview={() => setPreviewIndex(index)}
              onPublish={publish}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[1.5rem] border border-black/[0.06] bg-white/90 shadow-sm">
          {assets.map((asset, index) => (
            <ListRow
              key={asset.id}
              asset={asset}
              showDiagnostics={showDiagnostics}
              publishing={publishingId === asset.id}
              onPreview={() => setPreviewIndex(index)}
              onPublish={publish}
            />
          ))}
        </div>
      )}
      {previewIndex !== null && (
        <PreviewDialog
          asset={assets[previewIndex]!}
          current={previewIndex}
          total={assets.length}
          onClose={() => setPreviewIndex(null)}
          onPrevious={() => setPreviewIndex((index) => Math.max(0, (index ?? 0) - 1))}
          onNext={() => setPreviewIndex((index) => Math.min(assets.length - 1, (index ?? 0) + 1))}
        />
      )}
    </div>
  );
}

function AssetStatus({ asset }: { asset: AssetSummary }) {
  const tone =
    asset.processingStatus === "failed"
      ? "text-red-700"
      : asset.processingStatus === "completed"
        ? "text-emerald-700"
        : "text-amber-700";
  const Icon =
    asset.processingStatus === "failed"
      ? AlertCircle
      : asset.processingStatus === "completed"
        ? CheckCircle2
        : Clock3;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${tone}`}>
      <Icon className="size-3" />
      {processingLabel[asset.processingStatus]}
    </span>
  );
}

function AssetTags({ asset }: { asset: AssetSummary }) {
  return (
    <div className="flex min-h-6 flex-wrap gap-1.5">
      {asset.tags.slice(0, 3).map((tag) => (
        <Badge key={`${tag.category}-${tag.value}`}>{tag.value}</Badge>
      ))}
    </div>
  );
}

function Diagnostics({ asset }: { asset: AssetSummary }) {
  if (asset.searchScore === undefined) return null;
  return (
    <div className="flex flex-wrap gap-2 border-t border-black/[0.06] pt-3 text-xs text-slate-500">
      <span>排序分：{asset.searchScore.toFixed(1)}</span>
      {asset.semanticScore !== undefined && <span>语义分：{asset.semanticScore.toFixed(3)}</span>}
    </div>
  );
}

function GalleryCard({
  asset,
  showDiagnostics,
  publishing,
  onPreview,
  onPublish,
}: {
  asset: AssetSummary;
  showDiagnostics: boolean;
  publishing: boolean;
  onPreview: () => void;
  onPublish: (assetId: string) => Promise<void>;
}) {
  const canPublish = asset.processingStatus === "completed" && asset.reviewStatus === "pending_review";
  return (
    <Card className="group h-full overflow-hidden bg-white/90 transition-[box-shadow,transform] duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_34px_rgba(0,0,0,0.10)] motion-reduce:transition-none">
      <button type="button" className="relative block w-full text-left" onClick={onPreview} aria-label={`预览 ${asset.name}`}>
        <div className="aspect-[4/3] overflow-hidden bg-[#e9e9eb]">
          <MediaPreview mediaType={asset.mediaType} src={asset.mediaUrl} name={asset.name} className="transition-transform duration-500 ease-out group-hover:scale-[1.025] motion-reduce:transition-none" />
        </div>
        <span className="absolute right-3 top-3 rounded-full bg-black/45 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-md">
          {asset.mediaType === "image" ? "图片" : "视频"}
        </span>
      </button>
      <CardContent className="space-y-3 p-4 pt-4">
        <div className="flex items-center justify-between gap-3">
          <Link href={`/assets/${asset.id}`} className="truncate font-semibold tracking-tight hover:text-[#0071e3]">
            {asset.name}
          </Link>
          <span className="shrink-0 text-xs text-slate-400">{asset.reviewStatus === "published" ? "已入库" : "待审核"}</span>
        </div>
        <AssetStatus asset={asset} />
        <AssetTags asset={asset} />
        {showDiagnostics && <Diagnostics asset={asset} />}
      </CardContent>
      {canPublish && (
        <CardContent className="pt-0">
          <Button className="w-full" size="sm" disabled={publishing} onClick={() => void onPublish(asset.id)}>
            <Send className="size-3.5" />
            {publishing ? "正在入库…" : "确认入库"}
          </Button>
        </CardContent>
      )}
    </Card>
  );
}

function ListRow({
  asset,
  showDiagnostics,
  publishing,
  onPreview,
  onPublish,
}: {
  asset: AssetSummary;
  showDiagnostics: boolean;
  publishing: boolean;
  onPreview: () => void;
  onPublish: (assetId: string) => Promise<void>;
}) {
  const canPublish = asset.processingStatus === "completed" && asset.reviewStatus === "pending_review";
  return (
    <article className="flex gap-4 border-b border-black/[0.06] p-3 last:border-0 sm:items-center sm:p-4">
      <button type="button" className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-[#e9e9eb] sm:size-24" onClick={onPreview} aria-label={`预览 ${asset.name}`}>
        <MediaPreview mediaType={asset.mediaType} src={asset.mediaUrl} name={asset.name} />
      </button>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-3">
          <Link href={`/assets/${asset.id}`} className="truncate font-semibold tracking-tight hover:text-[#0071e3]">
            {asset.name}
          </Link>
          <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">{asset.mediaType === "image" ? "图片" : "视频"}</span>
        </div>
        <p className="line-clamp-1 text-sm text-slate-500">{asset.description || "暂无描述"}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><AssetStatus asset={asset} /><AssetTags asset={asset} /></div>
        {showDiagnostics && <Diagnostics asset={asset} />}
      </div>
      <div className="hidden shrink-0 items-center gap-2 sm:flex">
        <Button variant="ghost" size="sm" onClick={onPreview} aria-label={`预览 ${asset.name}`}><Eye className="size-3.5" /></Button>
        {canPublish && <Button size="sm" disabled={publishing} onClick={() => void onPublish(asset.id)}>{publishing ? "正在入库…" : "入库"}</Button>}
      </div>
    </article>
  );
}

function PreviewDialog({
  asset,
  current,
  total,
  onClose,
  onPrevious,
  onNext,
}: {
  asset: AssetSummary;
  current: number;
  total: number;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label={`${asset.name} 预览`}>
      <button type="button" className="absolute inset-0 cursor-default" aria-label="关闭预览" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-[1.75rem] bg-[#1d1d1f] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 text-white">
          <div className="min-w-0"><p className="truncate font-medium">{asset.name}</p><p className="mt-0.5 text-xs text-white/60">{current + 1} / {total}</p></div>
          <div className="flex items-center gap-2"><Link href={`/assets/${asset.id}`} className="rounded-full bg-white/15 px-3 py-2 text-sm hover:bg-white/25">查看详情</Link><Button variant="ghost" size="sm" className="text-white hover:bg-white/15 hover:text-white" onClick={onClose} aria-label="关闭预览"><X className="size-4" /></Button></div>
        </div>
        <div className="relative min-h-0 flex-1 bg-black"><MediaPreview mediaType={asset.mediaType} src={asset.mediaUrl} name={asset.name} className="object-contain" />
          <button type="button" className="absolute left-4 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-white backdrop-blur transition hover:bg-white/25 disabled:opacity-30" onClick={onPrevious} disabled={current === 0} aria-label="上一个素材"><ChevronLeft className="size-5" /></button>
          <button type="button" className="absolute right-4 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-white backdrop-blur transition hover:bg-white/25 disabled:opacity-30" onClick={onNext} disabled={current === total - 1} aria-label="下一个素材"><ChevronRight className="size-5" /></button>
        </div>
        <div className="border-t border-white/10 px-5 py-4 text-sm text-white/70"><div className="flex flex-wrap gap-2">{asset.tags.map((tag) => <span key={`${tag.category}-${tag.value}`} className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/85">{tag.value}</span>)}</div></div>
      </div>
    </div>
  );
}
