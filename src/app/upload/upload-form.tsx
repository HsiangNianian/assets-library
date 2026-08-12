"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  FileVideo2,
  ImageIcon,
  LoaderCircle,
  Plus,
  UploadCloud,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { UploadStatus } from "@/shared/contracts";

interface ApiError {
  error?: { message?: string };
}

type UploadPhase =
  | "queued"
  | "uploading"
  | "processing"
  | "completed"
  | "failed";

interface UploadItem {
  id: string;
  file: File;
  previewUrl: string;
  phase: UploadPhase;
  progress: number;
  status: UploadStatus | null;
  error: string;
}

function createUploadId(): string {
  const browserCrypto = globalThis.crypto;
  if (typeof browserCrypto?.randomUUID === "function") {
    return browserCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (browserCrypto?.getRandomValues) {
    browserCrypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return Array.from(bytes, (byte, index) => {
    const separator = [4, 6, 8, 10].includes(index) ? "-" : "";
    return `${separator}${byte.toString(16).padStart(2, "0")}`;
  }).join("");
}

const phaseLabels: Record<UploadPhase, string> = {
  queued: "等待上传",
  uploading: "正在上传",
  processing: "正在分析",
  completed: "分析完成",
  failed: "上传或处理失败",
};

function isVideo(file: File) {
  return file.name.toLocaleLowerCase().endsWith(".mp4");
}

export function UploadForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef(new Set<string>());
  const pollControllersRef = useRef(new Map<string, AbortController>());
  const mountedRef = useRef(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [directPublish, setDirectPublish] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    const controllers = pollControllersRef.current;
    const previewUrls = previewUrlsRef.current;
    return () => {
      mountedRef.current = false;
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
      for (const previewUrl of previewUrls) URL.revokeObjectURL(previewUrl);
      previewUrls.clear();
    };
  }, []);

  const updateItem = (itemId: string, patch: Partial<UploadItem>) => {
    if (!mountedRef.current) return;
    setItems((current) =>
      current.map((item) =>
        item.id === itemId ? { ...item, ...patch } : item,
      ),
    );
  };

  const poll = async (itemId: string, uploadId: string) => {
    if (!mountedRef.current) return;
    const controller = new AbortController();
    pollControllersRef.current.set(itemId, controller);
    try {
      for (;;) {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            window.clearTimeout(timer);
            reject(new DOMException("Polling stopped.", "AbortError"));
          };
          const timer = window.setTimeout(() => {
            controller.signal.removeEventListener("abort", onAbort);
            resolve();
          }, 1_000);
          controller.signal.addEventListener("abort", onAbort, { once: true });
        });
        const response = await fetch(`/api/uploads/${uploadId}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!mountedRef.current) return;
        if (!response.ok) {
          let message = `无法获取处理状态（HTTP ${response.status}），请前往素材概览查看。`;
          try {
            const payload = (await response.json()) as ApiError;
            message = payload.error?.message ?? message;
          } catch {
            // Keep the actionable fallback when the response is not JSON.
          }
          updateItem(itemId, {
            phase: "failed",
            error: message,
          });
          return;
        }
        const status = (await response.json()) as UploadStatus;
        if (!mountedRef.current) return;
        if (status.processingStatus === "completed") {
          updateItem(itemId, {
            status,
            phase: "completed",
            progress: 100,
          });
          return;
        }
        if (status.processingStatus === "failed") {
          updateItem(itemId, {
            status,
            phase: "failed",
            progress: 100,
            error: status.failureMessage ?? "素材分析失败。",
          });
          return;
        }
        updateItem(itemId, {
          status,
          phase: "processing",
          progress: status.progressPercent,
        });
      }
    } catch (cause) {
      if (
        mountedRef.current &&
        !(cause instanceof DOMException && cause.name === "AbortError")
      ) {
        updateItem(itemId, {
          phase: "failed",
          error: "无法获取处理状态，请前往素材概览查看。",
        });
      }
    } finally {
      if (pollControllersRef.current.get(itemId) === controller) {
        pollControllersRef.current.delete(itemId);
      }
    }
  };

  const sendItem = async (
    item: UploadItem,
    publishAfterAnalysis: boolean,
  ) => {
    const body = new FormData();
    body.append("file", item.file);
    body.append("directPublish", String(publishAfterAnalysis));

    updateItem(item.id, { phase: "uploading", progress: 0, error: "" });
    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", isVideo(item.file) ? "/api/uploads/videos" : "/api/uploads/images");
      xhr.upload.onprogress = (event) => {
        if (mountedRef.current && event.lengthComputable) {
          updateItem(item.id, {
            progress: Math.round((event.loaded / event.total) * 100),
          });
        }
      };
      xhr.onerror = () => {
        updateItem(item.id, {
          phase: "failed",
          error: "网络连接中断，请重试。",
        });
        resolve();
      };
      xhr.onload = () => {
        if (!mountedRef.current) {
          resolve();
          return;
        }
        let payload: (UploadStatus & ApiError) | null = null;
        try {
          payload = JSON.parse(xhr.responseText || "{}") as UploadStatus &
            ApiError;
        } catch {
          // The fallback below handles a non-JSON server response.
        }
        if (xhr.status !== 202 || !payload?.uploadId) {
          updateItem(item.id, {
            phase: "failed",
            error: payload?.error?.message ?? "上传失败，请检查文件。",
          });
          resolve();
          return;
        }
        updateItem(item.id, {
          status: payload,
          phase: "processing",
          progress: payload.progressPercent,
        });
        void poll(item.id, payload.uploadId);
        resolve();
      };
      xhr.send(body);
    });
  };

  const upload = async () => {
    const queuedItems = items.filter((item) => item.phase === "queued");
    if (queuedItems.length === 0) return;
    setSubmitting(true);
    setError("");
    const publishAfterAnalysis = directPublish;
    try {
      for (const item of queuedItems) {
        if (!mountedRef.current) return;
        await sendItem(item, publishAfterAnalysis);
      }
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  };

  const choose = (selected: File[]) => {
    if (selected.length === 0) return;
    const additions = selected.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.add(previewUrl);
      return {
        id: createUploadId(),
        file,
        previewUrl,
        phase: "queued",
        progress: 0,
        status: null,
        error: "",
      } satisfies UploadItem;
    });
    setItems((current) => [...current, ...additions]);
    setError("");
  };

  const removeItem = (item: UploadItem) => {
    if (item.phase !== "queued") return;
    URL.revokeObjectURL(item.previewUrl);
    previewUrlsRef.current.delete(item.previewUrl);
    setItems((current) => current.filter((currentItem) => currentItem.id !== item.id));
  };

  const queuedCount = items.filter((item) => item.phase === "queued").length;
  const failedCount = items.filter((item) => item.phase === "failed").length;

  return (
    <Card>
      <CardHeader>
        <div
          data-testid="upload-dropzone"
          className="flex h-64 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/70 p-4 text-center transition hover:border-cyan-400 hover:bg-cyan-50/40"
          onClick={() => {
            if (!submitting) inputRef.current?.click();
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (submitting) {
              setError("当前批次正在上传，请稍后再添加素材。");
              return;
            }
            choose(Array.from(event.dataTransfer.files));
          }}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            disabled={submitting}
            accept=".jpg,.jpeg,.png,.webp,.mp4,image/jpeg,image/png,image/webp,video/mp4"
            onChange={(event) => {
              choose(Array.from(event.target.files ?? []));
              event.currentTarget.value = "";
            }}
          />
          {items.length === 0 ? (
            <>
              <span className="mb-5 grid size-16 place-items-center rounded-2xl bg-white text-cyan-700 shadow-sm">
                <UploadCloud className="size-8" />
              </span>
              <h2 className="text-lg font-semibold">
                拖放一个或多个文件到这里，或点击选择
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                JPEG / PNG / WebP ≤ 20 MB · MP4 视频 ≤ 200 MB
              </p>
            </>
          ) : (
            <div
              className="flex h-full min-h-0 w-full cursor-default flex-col text-left"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-2 pb-3">
                <p className="text-sm font-medium">
                  已选择 {items.length} 个素材
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={submitting}
                  onClick={() => inputRef.current?.click()}
                >
                  <Plus className="size-4" />
                  继续添加
                </Button>
              </div>
              <ul
                aria-label="上传素材列表"
                className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain py-3 pr-1"
              >
                {items.map((item) => (
                  <li
                    key={item.id}
                    tabIndex={0}
                    className="group rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none transition hover:border-cyan-300 focus:border-cyan-400"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {item.file.name}
                      </span>
                      <span
                        className={`shrink-0 text-xs ${
                          item.phase === "failed"
                            ? "font-medium text-red-600"
                            : "text-slate-500"
                        }`}
                      >
                        {phaseLabels[item.phase]}
                      </span>
                      {item.phase === "queued" && (
                        <button
                          type="button"
                          aria-label={`移除 ${item.file.name}`}
                          className="hidden shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600 group-hover:block group-focus:block"
                          onClick={() => removeItem(item)}
                        >
                          <X className="size-4" />
                        </button>
                      )}
                    </div>
                    {item.error && (
                      <p
                        role="alert"
                        className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-700"
                      >
                        <XCircle className="mt-0.5 size-3.5 shrink-0" />
                        {item.error}
                      </p>
                    )}

                    <div
                      aria-label={`${item.file.name} 预览`}
                      className="mt-2 hidden border-t border-slate-100 pt-2 group-hover:block group-focus-within:block"
                    >
                      <div className="relative h-28 overflow-hidden rounded-lg bg-slate-950">
                        {isVideo(item.file) ? (
                          <video
                            src={item.previewUrl}
                            controls
                            muted
                            preload="metadata"
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <Image
                            src={item.previewUrl}
                            alt={`${item.file.name} 预览`}
                            fill
                            unoptimized
                            className="object-contain"
                          />
                        )}
                      </div>
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                        <span className="flex min-w-0 items-center gap-1.5">
                          {isVideo(item.file) ? (
                            <FileVideo2 className="size-3.5 shrink-0" />
                          ) : (
                            <ImageIcon className="size-3.5 shrink-0" />
                          )}
                          {(item.file.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                      </div>
                      {(item.phase === "uploading" ||
                        item.phase === "processing") && (
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-cyan-500 transition-all"
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>
                      )}
                      {item.status && (
                        <Link
                          href={`/assets/${item.status.assetId}`}
                          className="mt-2 inline-flex text-xs font-medium text-cyan-700 hover:underline"
                        >
                          查看素材详情
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-4">
          <input
            type="checkbox"
            checked={directPublish}
            disabled={submitting}
            onChange={(event) => setDirectPublish(event.target.checked)}
            className="mt-0.5 size-4 accent-cyan-600"
          />
          <span>
            <span className="block text-sm font-medium">
              分析完成后直接入库
            </span>
            <span className="mt-1 block text-xs text-slate-500">
              关闭时，分析结果需要在详情页审核和确认。
            </span>
          </span>
        </label>

        {error && (
          <p className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <XCircle className="size-4 shrink-0" /> {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-500">
            {items.length === 0
              ? "可一次选择多个素材，系统会逐个提交。"
              : failedCount > 0 && queuedCount > 0
                ? `${failedCount} 个素材上传或处理失败；还有 ${queuedCount} 个等待上传。`
                : failedCount > 0
                  ? `${failedCount} 个素材上传或处理失败，请查看原因。`
                : queuedCount > 0
                  ? `还有 ${queuedCount} 个素材等待上传。`
                  : "所选素材均已提交，可在素材概览继续查看状态。"}
          </p>
          <Button
            disabled={queuedCount === 0 || submitting}
            onClick={() => void upload()}
          >
            {submitting ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                正在上传…
              </>
            ) : (
              <>
                <CheckCircle2 className="size-4" />
                开始上传
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
