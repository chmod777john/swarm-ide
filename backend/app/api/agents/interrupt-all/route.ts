export const runtime = "nodejs";

import { getAgentRuntime } from "@/runtime/agent-runtime";
import { getWorkspaceUIBus } from "@/runtime/ui-bus";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | {
        workspaceId?: string;
      }
    | null;

  const workspaceId = body?.workspaceId?.trim();
  if (!workspaceId) {
    return Response.json({ error: "Missing workspaceId" }, { status: 400 });
  }

  const agentRuntime = getAgentRuntime();
  const result = await agentRuntime.interruptAll({ workspaceId });

  getWorkspaceUIBus().emit(workspaceId, {
    event: "ui.agent.interrupt_all",
    data: {
      workspaceId,
      interrupted: result.interrupted,
      agentIds: result.agentIds,
    },
  });

  return Response.json({ ok: true, ...result });
}
