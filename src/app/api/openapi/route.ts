import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const specPath = path.join(process.cwd(), "spec/contracts/openapi.yaml");
  const specification = await fs.readFile(specPath, "utf8");
  return new Response(specification, {
    headers: {
      "content-type": "application/yaml; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
