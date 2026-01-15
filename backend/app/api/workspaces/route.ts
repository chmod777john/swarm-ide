export const runtime = "nodejs";

import { store } from "@/lib/storage";

export async function GET() {
  try {
    const workspaces = await store.listWorkspaces();
    return Response.json({ workspaces });
  } catch (e) {
    return Response.json(
      {
        error: "Database not ready",
        message: e instanceof Error ? e.message : String(e),
        hint: "Run POST /api/admin/init-db after starting Postgres",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { name?: string } | null;
    const result = await store.createWorkspaceWithDefaults({
      name: body?.name ?? "Default Workspace",
    });
    return Response.json(result, { status: 201 });
  } catch (e) {
    return Response.json(
      {
        error: "Failed to create workspace",
        message: e instanceof Error ? e.message : String(e),
        hint: "Check DATABASE_URL, start Postgres, then POST /api/admin/init-db",
      },
      { status: 500 }
    );
  }
}
