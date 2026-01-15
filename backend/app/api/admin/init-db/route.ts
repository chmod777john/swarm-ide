export const runtime = "nodejs";

import { ensureSchema } from "@/db/init";

export async function POST() {
  try {
    await ensureSchema();
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      {
        ok: false,
        error: "Failed to init schema",
        message: e instanceof Error ? e.message : String(e),
        hint:
          "Ensure DATABASE_URL (or POSTGRES_URL) is set to a reachable Postgres instance, then retry.",
      },
      { status: 500 }
    );
  }
}
