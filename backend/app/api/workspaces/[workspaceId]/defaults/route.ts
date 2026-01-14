export const runtime = "nodejs";

import { store } from "@/lib/storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const result = await store.ensureWorkspaceDefaults({ workspaceId });
  return Response.json(result);
}

