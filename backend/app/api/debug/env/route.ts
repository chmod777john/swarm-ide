export const runtime = "nodejs";

function redact(value: string) {
  if (!value) return value;
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function safeUrl(raw: string | undefined | null) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return {
      protocol: url.protocol.replace(":", ""),
      host: url.host,
      pathname: url.pathname,
      username: url.username ? redact(url.username) : "",
      password: url.password ? "***" : "",
      rawRedacted: `${url.protocol}//${url.username ? "***" : ""}${url.username && url.password ? ":" : ""}${url.password ? "***" : ""}${url.username || url.password ? "@" : ""}${url.host}${url.pathname}`,
    };
  } catch {
    return { rawRedacted: redact(raw) };
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const nodeEnv = process.env.NODE_ENV ?? "unknown";

  const dbRaw =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_PRISMA_URL ??
    null;

  const redisRaw =
    process.env.REDIS_URL ??
    process.env.UPSTASH_REDIS_REST_URL ??
    process.env.UPSTASH_REDIS_URL ??
    null;

  return Response.json({
    ok: true,
    requestHost: url.host,
    nodeEnv,
    has: {
      DATABASE_URL: !!process.env.DATABASE_URL,
      POSTGRES_URL: !!process.env.POSTGRES_URL,
      DATABASE_URL_UNPOOLED: !!process.env.DATABASE_URL_UNPOOLED,
      POSTGRES_URL_NON_POOLING: !!process.env.POSTGRES_URL_NON_POOLING,
      POSTGRES_PRISMA_URL: !!process.env.POSTGRES_PRISMA_URL,
      REDIS_URL: !!process.env.REDIS_URL,
      UPSTASH_REDIS_REST_URL: !!process.env.UPSTASH_REDIS_REST_URL,
      UPSTASH_REDIS_URL: !!process.env.UPSTASH_REDIS_URL,
    },
    database: safeUrl(dbRaw),
    redis: safeUrl(redisRaw),
  });
}
