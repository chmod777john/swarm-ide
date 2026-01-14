import { drizzle } from "drizzle-orm/postgres-js";

import { getSql } from "./client";

let cachedDb: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (cachedDb) return cachedDb;
  cachedDb = drizzle(getSql());
  return cachedDb;
}
