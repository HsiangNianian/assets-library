import type { FailureCode } from "@/shared/contracts";
import { ZodError } from "zod";

const messages: Record<FailureCode, string> = {
  invalid_request: "上传请求无效，请重新选择文件。",
  multiple_files: "单次只能上传一个文件。",
  unsupported_media_type: "仅支持 JPEG、PNG、WebP 图片和 H.264 MP4 视频。",
  file_too_large: "文件超过对应类型的大小限制。",
  corrupt_file: "文件已损坏或无法读取，请更换文件。",
  unsupported_video_codec: "MP4 视频必须使用 H.264 编码。",
  model_not_configured: "模型服务尚未配置，请联系管理员。",
  model_video_unsupported: "当前模型协议不支持视频，请更换为支持 video_url 的 Chat Completions 配置。",
  model_video_public_url_required:
    "视频达到 7 MiB，无法使用 Base64 传递。请配置公网 HTTPS APP_PUBLIC_URL 后重试。",
  model_request_failed: "模型服务请求失败，请稍后重试。",
  model_response_invalid: "模型返回内容无法验证，请重试或更换模型。",
  storage_error: "文件保存失败，请重试。",
  internal_error: "系统处理失败，请稍后重试。",
};

export class AppError extends Error {
  constructor(
    public readonly code: FailureCode,
    message: string = messages[code],
    public readonly status = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorResponse(error: unknown) {
  const appError =
    error instanceof AppError
      ? error
      : error instanceof ZodError
        ? new AppError(
            "invalid_request",
            error.issues[0]?.message ?? "请求字段无效。",
            400,
          )
      : new AppError("internal_error", undefined, 500);
  return Response.json(
    { error: { code: appError.code, message: appError.message } },
    { status: appError.status },
  );
}
