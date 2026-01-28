export const runtime = "nodejs";

import { getConfig } from "@/lib/config";

export async function GET() {
  const config = getConfig();
  return Response.json(config);
}
