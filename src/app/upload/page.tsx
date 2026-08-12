import { UploadForm } from "./upload-form";

export default function UploadPage() {
  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
      <div className="mb-8">
        <p className="mb-2 text-sm font-semibold tracking-wide text-cyan-700">
          NEW ASSET
        </p>
        <h1 className="text-3xl font-bold tracking-tight">上传素材</h1>
        <p className="mt-3 text-slate-600">
          支持一次选择多个本地素材并逐个上传。系统会按文件扩展名转换图片，
          并把可解码的视频转换为 H.264 MP4，再自动提取 1–5
          张关键帧分析画面。
        </p>
      </div>
      <UploadForm />
    </main>
  );
}
