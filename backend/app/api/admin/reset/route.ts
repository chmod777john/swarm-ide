export const runtime = "nodejs";

import { getSql } from "@/db/client";
import { ensureSchema } from "@/db/init";
import { getUpstashRedis, isUpstashRealtimeConfigured } from "@/runtime/upstash-realtime";

export async function POST() {
  const sql = getSql();

  await sql/* sql */ `
    truncate table
      messages,
      group_members,
      groups,
      agents,
      workspaces
    restart identity cascade;
  `;

  if (isUpstashRealtimeConfigured()) {
    const redis = await getUpstashRedis();
    const keys = [
      ...(await redis.keys("agent:*")),
      ...(await redis.keys("ui:*")),
    ];
    if (keys.length > 0) {
      await redis.del(keys);
    }
  }

  await ensureSchema();

  return Response.json({ ok: true });
}
