import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AppError } from "@/server/errors";

const execFileAsync = promisify(execFile);

type MediaCommandError = NodeJS.ErrnoException & {
  killed?: boolean;
  signal?: NodeJS.Signals;
};

export async function runMediaCommand(
  command: "ffmpeg" | "ffprobe",
  args: string[],
  failure: AppError,
  timeoutMs = 60_000,
) {
  try {
    return await execFileAsync(command, args, {
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    const commandError = error as MediaCommandError;
    if (commandError.code === "ENOENT" || commandError.code === "EACCES") {
      throw new AppError(
        "internal_error",
        "服务端媒体处理工具不可用，请联系管理员。",
        500,
      );
    }
    if (
      commandError.killed ||
      commandError.signal ||
      commandError.code === "ETIMEDOUT"
    ) {
      throw new AppError(
        "internal_error",
        "媒体处理超时，请稍后重试或上传较短的文件。",
        500,
      );
    }
    throw failure;
  }
}
