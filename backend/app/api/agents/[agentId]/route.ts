export const runtime = "nodejs";

import { store } from "@/lib/storage";

export async function GET(
  _req: Request,
  { params }: { params: { agentId: string } }
) {
  const agentId = params.agentId?.trim();
  if (!agentId) {
    return Response.json({ error: "Missing agentId" }, { status: 400 });
  }

  const agent = await store.getAgent({ agentId });
  return Response.json({
    agentId: agent.id,
    role: agent.role,
    llmHistory: agent.llmHistory,
  });
}
