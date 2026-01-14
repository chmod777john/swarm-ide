export const runtime = "nodejs";

import { store } from "@/lib/storage";
import { getAgentRuntime } from "@/runtime/agent-runtime";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const url = new URL(req.url);
  const markRead = url.searchParams.get("markRead") === "true";
  const readerId = url.searchParams.get("readerId") ?? undefined;

  const messages = await store.listMessages({
    groupId,
  });

  if (markRead && readerId) {
    await store.markGroupRead({ groupId, readerId });
  }

  return Response.json({ messages });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const body = (await req.json()) as {
    senderId: string;
    content: string;
    contentType?: string;
  };

  const result = await store.sendMessage({
    groupId,
    senderId: body.senderId,
    content: body.content,
    contentType: body.contentType ?? "text",
  });

  const runtime = getAgentRuntime();
  void runtime.wakeAgentsForGroup(groupId, body.senderId);

  return Response.json(result, { status: 201 });
}
