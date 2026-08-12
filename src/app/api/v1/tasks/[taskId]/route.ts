import { parseUuid, withApiV1 } from "@/server/api/handler";
import { getApiV1Service } from "@/server/api/v1/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  return withApiV1(request, async () => {
    const { taskId: rawTaskId } = await context.params;
    const task = await getApiV1Service().getTask(
      parseUuid(rawTaskId, "task_id"),
    );
    return Response.json(task, {
      headers: { "cache-control": "no-store" },
    });
  });
}
