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
          单次上传一个本地文件。视频会自动提取 1–5 张关键帧，仅分析画面；第一阶段不支持音频、URL、批量上传和转码。
        </p>
      </div>
      <UploadForm />
    </main>
  );
}
