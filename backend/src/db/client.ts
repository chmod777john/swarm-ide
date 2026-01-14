import postgres from "postgres";

let cachedSql: ReturnType<typeof postgres> | null = null;

export function getSql() {
  if (cachedSql) return cachedSql;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Missing `DATABASE_URL`");
  }

  cachedSql = postgres(databaseUrl, { max: 10 });
  return cachedSql;
}
