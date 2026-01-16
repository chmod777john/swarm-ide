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

  let groupId: string;
  let createdAt = new Date().toISOString();

  if (memberIds.length === 2) {
    groupId =
      (await store.mergeDuplicateExactP2PGroups({
        workspaceId,
        memberA: memberIds[0]!,
        memberB: memberIds[1]!,
        preferredName: body?.name ?? null,
      })) ??
      (
        await store.createGroup({
          workspaceId,
          memberIds,
          name: body?.name ?? undefined,
        })
      ).id;
  } else {
    groupId = (
      await store.createGroup({
        workspaceId,
        memberIds,
        name: body?.name ?? undefined,
      })
    ).id;
  }

  const groups = await store.listGroups({
    workspaceId,
    agentId: memberIds[0],
  });
  const found = groups.find((g) => g.id === groupId);
  if (found) {
    createdAt = found.createdAt;
  }

  getWorkspaceUIBus().emit(workspaceId, {
    event: "ui.group.created",
    data: { workspaceId, group: { id: groupId, name: body?.name ?? null, memberIds } },
  });

  return Response.json({ ok: true, groupId, createdAt }, { status: 201 });
}
