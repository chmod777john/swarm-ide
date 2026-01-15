export const runtime = "nodejs";

import { store } from "@/lib/storage";

type UUID = string;

type GraphNode = { id: UUID; role: string; parentId: UUID | null };
type GraphEdge = { from: UUID; to: UUID; count: number; lastSendTime: string };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspaceId = (url.searchParams.get("workspaceId") ?? "").trim();
  const limitMessages = Number(url.searchParams.get("limitMessages") ?? "2000") || 2000;

  if (!workspaceId) {
    return Response.json({ error: "Missing workspaceId" }, { status: 400 });
  }

  const agents = await store.listAgentsMeta({ workspaceId });
  const groups = await store.listGroups({ workspaceId });
  const recentMessages = await store.listRecentWorkspaceMessages({ workspaceId, limit: limitMessages });

  const groupMembersById = new Map<UUID, UUID[]>();
  for (const g of groups) {
    groupMembersById.set(g.id, g.memberIds);
  }

  const edgeByKey = new Map<string, GraphEdge>();
  for (const m of recentMessages) {
    const members = groupMembersById.get(m.groupId) ?? [];
    for (const to of members) {
      if (to === m.senderId) continue;
      const key = `${m.senderId}=>${to}`;
      const existing = edgeByKey.get(key);
      if (!existing) {
        edgeByKey.set(key, { from: m.senderId, to, count: 1, lastSendTime: m.sendTime });
      } else {
        existing.count += 1;
        if (m.sendTime > existing.lastSendTime) existing.lastSendTime = m.sendTime;
      }
    }
  }

  const nodes: GraphNode[] = agents.map((a) => ({
    id: a.id,
    role: a.role,
    parentId: a.parentId,
  }));

  const edges = [...edgeByKey.values()].sort((a, b) => b.lastSendTime.localeCompare(a.lastSendTime));

  return Response.json({
    nodes,
    edges,
    meta: {
      workspaceId,
      groups: groups.length,
      agents: agents.length,
      messagesConsidered: recentMessages.length,
    },
  });
}

