"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileVideo2, ImageIcon, UploadCloud, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { UploadStatus } from "@/shared/contracts";
import { extractVideoFrames } from "./extract-video-frames";

interface ApiError {
  error?: { message?: string };
}

export function UploadForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [directPublish, setDirectPublish] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<UploadStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const pollControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pollControllerRef.current?.abort();
    };
  }, []);

  const poll = async (uploadId: string) => {
    if (!mountedRef.current) return;
    pollControllerRef.current?.abort();
    const controller = new AbortController();
    pollControllerRef.current = controller;
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
        if (!response.ok || !mountedRef.current) return;
        const next = (await response.json()) as UploadStatus;
        if (!mountedRef.current) return;
        setStatus(next);
        if (
          next.processingStatus === "completed" ||
          next.processingStatus === "failed"
        ) {
          setBusy(false);
          return;
        }
      }
    } catch (cause) {
      if (
        mountedRef.current &&
        !(cause instanceof DOMException && cause.name === "AbortError")
      ) {
        setError("无法获取处理状态，请前往素材概览查看。");
        setBusy(false);
      }
    } finally {
      if (pollControllerRef.current === controller) {
        pollControllerRef.current = null;
      }
    }
  };

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    setProgress(0);
    setExtracting(false);
    const body = new FormData();
    try {
      body.append("file", file);
      if (file.type === "video/mp4" || file.name.toLowerCase().endsWith(".mp4")) {
        setExtracting(true);
        const extracted = await extractVideoFrames(file);
        if (!mountedRef.current) return;
        for (const frame of extracted.frames) body.append("frame", frame);
        body.append("frameMetadata", JSON.stringify(extracted.metadata));
        setExtracting(false);
      }
      body.append("directPublish", String(directPublish));
    } catch (cause) {
      if (!mountedRef.current) return;
      setExtracting(false);
      setBusy(false);
      setError(cause instanceof Error ? cause.message : "视频关键帧提取失败。");
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.upload.onprogress = (event) => {
      if (mountedRef.current && event.lengthComputable) {
        setProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onerror = () => {
      if (!mountedRef.current) return;
      setError("网络连接中断，请重试。");
      setBusy(false);
      setExtracting(false);
    };
    xhr.onload = () => {
      if (!mountedRef.current) return;
      const payload = JSON.parse(xhr.responseText || "{}") as UploadStatus & ApiError;
      if (xhr.status !== 202) {
        setError(payload.error?.message ?? "上传失败，请检查文件。");
        setBusy(false);
        setExtracting(false);
        return;
      }
      setStatus(payload);
      void poll(payload.uploadId);
    };
    xhr.send(body);
  };

  const choose = (selected?: File) => {
    if (!selected) return;
    setFile(selected);
    setError("");
    setStatus(null);
    setProgress(0);
  };

  return (
    <Card>
      <CardHeader>
        <div
          className="flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/70 p-8 text-center transition hover:border-cyan-400 hover:bg-cyan-50/40"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (event.dataTransfer.files.length > 1) {
              setError("单次只能上传一个文件。");
              return;
            }
            choose(event.dataTransfer.files[0]);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            disabled={busy}
            accept=".jpg,.jpeg,.png,.webp,.mp4,image/jpeg,image/png,image/webp,video/mp4"
            onChange={(event) => choose(event.target.files?.[0])}
          />
          <span className="mb-5 grid size-16 place-items-center rounded-2xl bg-white text-cyan-700 shadow-sm">
            <UploadCloud className="size-8" />
          </span>
          <h2 className="text-lg font-semibold">
            {file ? file.name : "拖放文件到这里，或点击选择"}
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            JPEG / PNG / WebP ≤ 20 MB · H.264 MP4 ≤ 200 MB
          </p>
          {file && (
            <p className="mt-4 flex items-center gap-2 text-sm font-medium text-cyan-700">
              {file.type.startsWith("video") ? <FileVideo2 className="size-4" /> : <ImageIcon className="size-4" />}
              {(file.size / 1024 / 1024).toFixed(1)} MB
            </p>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-4">
          <input
            type="checkbox"
            checked={directPublish}
            disabled={busy}
            onChange={(event) => setDirectPublish(event.target.checked)}
            className="mt-0.5 size-4 accent-cyan-600"
          />
          <span>
            <span className="block text-sm font-medium">分析完成后直接入库</span>
            <span className="mt-1 block text-xs text-slate-500">
              关闭时，分析结果需要在详情页审核和确认。
            </span>
          </span>
        </label>

        {busy && (
          <div>
            <div className="mb-2 flex justify-between text-sm">
              <span>
                {extracting
                  ? "正在提取关键帧"
                  : status
                    ? "正在分析素材"
                    : "正在上传文件"}
              </span>
              <span>{extracting ? "准备中" : `${status?.progressPercent ?? progress}%`}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-cyan-500 transition-all"
                style={{
                  width: `${extracting ? 5 : (status?.progressPercent ?? progress)}%`,
                }}
              />
            </div>
          </div>
        )}

        {error && (
          <p className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <XCircle className="size-4 shrink-0" /> {error}
          </p>
        )}
        {status?.processingStatus === "failed" && (
          <p className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <XCircle className="mt-0.5 size-4 shrink-0" /> {status.failureMessage}
          </p>
        )}
        {status?.processingStatus === "completed" && (
          <p className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
            <CheckCircle2 className="size-4" /> 分析完成，可以查看和编辑结果。
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-3">
          {status && (
            <Button asChild variant="outline">
              <Link href={`/assets/${status.assetId}`}>查看素材详情</Link>
            </Button>
          )}
          <Button disabled={!file || busy} onClick={() => void upload()}>
            {busy ? "处理中…" : "开始上传"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
