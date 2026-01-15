export const runtime = "nodejs";

import { store } from "@/lib/storage";
import { getAgentRuntime } from "@/runtime/agent-runtime";
import { getWorkspaceUIBus } from "@/runtime/ui-bus";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | {
        workspaceId?: string;
        fromId?: string;
        toId?: string;
        content?: string;
        observerHumanId?: string | null;
      }
    | null;

  const workspaceId = body?.workspaceId?.trim();
  const fromId = body?.fromId?.trim();
  const toId = body?.toId?.trim();
  const content = body?.content?.trim();

  if (!workspaceId) return Response.json({ error: "Missing workspaceId" }, { status: 400 });
  if (!fromId) return Response.json({ error: "Missing fromId" }, { status: 400 });
  if (!toId) return Response.json({ error: "Missing toId" }, { status: 400 });
  if (!content) return Response.json({ error: "Missing content" }, { status: 400 });

  const observerHumanId = (body?.observerHumanId ?? null)?.trim?.() ?? null;
  const runtime = getAgentRuntime();
  await runtime.bootstrap();

  const fromRole = await store.getAgentRole({ agentId: fromId }).catch(() => null);
  const toRole = await store.getAgentRole({ agentId: toId }).catch(() => null);

  const delivered = await store.sendDirectMessage({
    workspaceId,
    fromId,
    toId,
    // Do not implicitly add a human observer for agent↔agent threads.
    observerHumanId: observerHumanId || (fromRole === "human" ? fromId : null),
    content,
    contentType: "text",
    groupName: null,
    newThread: false,
  });

  getWorkspaceUIBus().emit(workspaceId, {
    event: "ui.group.created",
    data: { workspaceId, group: { id: delivered.groupId, name: null, memberIds: [fromId, toId, observerHumanId].filter(Boolean) as string[] } },
  });
  getWorkspaceUIBus().emit(workspaceId, {
    event: "ui.message.created",
    data: { workspaceId, groupId: delivered.groupId, message: { id: delivered.messageId, senderId: fromId, sendTime: delivered.sendTime } },
  });

  if (toRole && toRole !== "human") {
    void runtime.wakeAgent(toId);
  }

  return Response.json({ ok: true, ...delivered });
}
