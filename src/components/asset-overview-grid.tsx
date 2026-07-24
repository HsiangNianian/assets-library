"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Clock3, Send } from "lucide-react";
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

function statusStyle(status: ProcessingStatus) {
  if (status === "failed") return "bg-red-100 text-red-700";
  if (status === "completed") return "bg-emerald-100 text-emerald-700";
  return "bg-amber-100 text-amber-700";
}

export function AssetOverviewGrid({ assets }: { assets: AssetSummary[] }) {
  const router = useRouter();
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const hasActiveJobs = assets.some((asset) =>
    ["queued", "validating", "analyzing"].includes(asset.processingStatus),
  );

  useEffect(() => {
    if (!hasActiveJobs) return;
    const timer = window.setInterval(() => router.refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [hasActiveJobs, router]);

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
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {assets.map((asset) => {
          const canPublish =
            asset.processingStatus === "completed" &&
            asset.reviewStatus === "pending_review";
          return (
            <Card
              key={asset.id}
              className="group h-full overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              <Link href={`/assets/${asset.id}`} className="block">
                <div className="aspect-[4/3] overflow-hidden bg-slate-100">
                  <MediaPreview
                    mediaType={asset.mediaType}
                    src={asset.mediaUrl}
                    name={asset.name}
                    className="transition duration-300 group-hover:scale-[1.02]"
                  />
                </div>
                <CardContent className="space-y-3 pt-5">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="truncate font-semibold">{asset.name}</h2>
                    <Badge>{asset.mediaType === "image" ? "图片" : "视频"}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge className={statusStyle(asset.processingStatus)}>
                      {asset.processingStatus === "failed" ? (
                        <AlertCircle className="mr-1 size-3" />
                      ) : asset.processingStatus === "completed" ? (
                        <CheckCircle2 className="mr-1 size-3" />
                      ) : (
                        <Clock3 className="mr-1 size-3" />
                      )}
                      {processingLabel[asset.processingStatus]}
                    </Badge>
                    <Badge>
                      {asset.reviewStatus === "published" ? "已入库" : "待入库"}
                    </Badge>
                  </div>
                  <p className="line-clamp-2 min-h-10 text-sm text-slate-500">
                    {asset.description ||
                      (asset.processingStatus === "failed"
                        ? "分析失败，可进入详情页重试。"
                        : "分析完成后生成描述。")}
                  </p>
                  <div className="flex min-h-6 flex-wrap gap-1.5">
                    {asset.tags.slice(0, 3).map((tag) => (
                      <Badge key={`${tag.category}-${tag.value}`}>
                        {tag.value}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Link>
              {canPublish && (
                <CardContent className="pt-0">
                  <Button
                    className="w-full"
                    size="sm"
                    disabled={publishingId === asset.id}
                    onClick={() => void publish(asset.id)}
                  >
                    <Send className="size-3.5" />
                    {publishingId === asset.id ? "正在入库…" : "确认入库"}
                  </Button>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
