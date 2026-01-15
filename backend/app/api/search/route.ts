export const runtime = "nodejs";

import { store } from "@/lib/storage";

type UUID = string;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspaceId = (url.searchParams.get("workspaceId") ?? "").trim();
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") ?? "20") || 20));

  if (!workspaceId) {
    return Response.json({ error: "Missing workspaceId" }, { status: 400 });
  }

  const agents = await store.listAgentsMeta({ workspaceId });
  const results = agents
    .filter((a) => a.id && a.role)
    .filter((a) => {
      if (!q) return true;
      return a.role.toLowerCase().includes(q) || a.id.toLowerCase().includes(q);
    })
    .slice(0, limit)
    .map((a) => ({ id: a.id as UUID, role: a.role, parentId: a.parentId, createdAt: a.createdAt }));

  return Response.json({ results });
}

