export const runtime = "nodejs";

import { ensureSchema } from "@/db/init";

export async function POST() {
  await ensureSchema();
  return Response.json({ ok: true });
}

