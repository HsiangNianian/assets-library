import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 规范文件与业务接口均用于可信内网，不要求 API Key。
export async function GET() {
  const specification = await fs.readFile(
    path.join(process.cwd(), "spec/contracts/openapi.yaml"),
    "utf8",
  );
  return new Response(specification, {
    headers: {
      "content-type": "application/yaml; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
