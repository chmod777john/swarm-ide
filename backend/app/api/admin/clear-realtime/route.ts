export const runtime = "nodejs";

import { getUpstashRedis, isUpstashRealtimeConfigured } from "@/runtime/upstash-realtime";

export async function POST() {
  if (!isUpstashRealtimeConfigured()) {
    return Response.json({ error: "Upstash not configured" }, { status: 400 });
  }

  const redis = getUpstashRedis();

  const keys = [
    ...(await redis.keys("agent:*")),
    ...(await redis.keys("ui:*")),
  ];

  if (keys.length > 0) {
    await redis.del(...keys);
  }

  return Response.json({ ok: true, deleted: keys.length });
}
