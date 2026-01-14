export const runtime = "nodejs";

import { store } from "@/lib/storage";

export async function GET() {
  const workspaces = await store.listWorkspaces();
  return Response.json({ workspaces });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { name?: string } | null;
  const result = await store.createWorkspaceWithDefaults({
    name: body?.name ?? "Default Workspace",
  });
  return Response.json(result, { status: 201 });
}
