export const runtime = "nodejs";

import { getSql } from "@/db/client";

export async function POST() {
  const sql = getSql();

  // Wipes all workspace-scoped data.
  // UUID PKs mean RESTART IDENTITY has no practical effect, but it's harmless.
  await sql/* sql */ `
    truncate table
      messages,
      group_members,
      groups,
      agents,
      workspaces
    restart identity cascade;
  `;

  return Response.json({ ok: true });
}

