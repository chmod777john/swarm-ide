export const runtime = "nodejs";

import { store } from "@/lib/storage";
import { getWorkspaceUIBus } from "@/runtime/ui-bus";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { workspaceId?: string; memberIds?: string[]; name?: string | null }
    | null;

  const workspaceId = body?.workspaceId?.trim();
  const memberIds = (body?.memberIds ?? []).map((x) => x.trim()).filter(Boolean);

  if (!workspaceId) return Response.json({ error: "Missing workspaceId" }, { status: 400 });
  if (memberIds.length < 2) {
    return Response.json({ error: "memberIds must have >= 2 members" }, { status: 400 });
  }

  const group = await store.createGroup({
    workspaceId,
    memberIds,
    name: body?.name ?? undefined,
  });

  getWorkspaceUIBus().emit(workspaceId, {
    event: "ui.group.created",
    data: { workspaceId, group: { id: group.id, name: body?.name ?? null, memberIds } },
  });

  return Response.json({ ok: true, groupId: group.id, createdAt: group.createdAt }, { status: 201 });
}
