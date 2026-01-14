export const runtime = "nodejs";

import { store } from "@/lib/storage";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
  const agentId = url.searchParams.get("agentId") ?? undefined;

  const groups = await store.listGroups({ workspaceId, agentId });
  return Response.json({ groups });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    workspaceId: string;
    memberIds: string[];
    name?: string;
  };

  const group = await store.createGroup(body);
  return Response.json(group, { status: 201 });
}
