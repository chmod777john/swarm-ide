export const runtime = "nodejs";

import { store } from "@/lib/storage";
import { getAgentRuntime } from "@/runtime/agent-runtime";
import { getWorkspaceUIBus } from "@/runtime/ui-bus";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
  const meta = url.searchParams.get("meta") === "true";

  if (!workspaceId) {
    return Response.json({ error: "Missing workspaceId" }, { status: 400 });
  }

  if (meta) {
    const agents = await store.listAgentsMeta({ workspaceId });
    return Response.json({ agents });
  }

  const agents = await store.listAgents({ workspaceId });
  return Response.json({ agents });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | {
        workspaceId?: string;
        creatorId?: string;
        role?: string;
        groupId?: string;
      }
    | null;

  const workspaceId = body?.workspaceId?.trim();
  const creatorId = body?.creatorId?.trim();
  const role = body?.role?.trim();

  if (!workspaceId) {
    return Response.json({ error: "Missing workspaceId" }, { status: 400 });
  }
  if (!creatorId) {
    return Response.json({ error: "Missing creatorId" }, { status: 400 });
  }
  if (!role) {
    return Response.json({ error: "Missing role" }, { status: 400 });
  }

  const runtime = getAgentRuntime();
  await runtime.bootstrap();
  const { humanAgentId } = await store.ensureWorkspaceDefaults({ workspaceId });

  if (body?.groupId) {
    const created = await store.createSubAgentWithP2P({ workspaceId, creatorId, role });
    await store.addGroupMembers({ groupId: body.groupId, userIds: [created.agentId] });
    runtime.ensureRunner(created.agentId);
    getWorkspaceUIBus().emit(workspaceId, {
      event: "ui.agent.created",
      data: { workspaceId, agent: { id: created.agentId, role, parentId: creatorId } },
    });
    getWorkspaceUIBus().emit(workspaceId, {
      event: "ui.group.created",
      data: {
        workspaceId,
        group: { id: created.groupId, name: role, memberIds: [humanAgentId, created.agentId] },
      },
    });

    return Response.json(
      { agentId: created.agentId, groupId: body.groupId, createdAt: created.createdAt },
      { status: 201 }
    );
  }

  const created = await store.createSubAgentWithP2P({ workspaceId, creatorId, role });
  runtime.ensureRunner(created.agentId);
  getWorkspaceUIBus().emit(workspaceId, {
    event: "ui.agent.created",
    data: { workspaceId, agent: { id: created.agentId, role, parentId: creatorId } },
  });
  getWorkspaceUIBus().emit(workspaceId, {
    event: "ui.group.created",
    data: { workspaceId, group: { id: created.groupId, name: role, memberIds: [humanAgentId, created.agentId] } },
  });

  return Response.json(created, { status: 201 });
}
