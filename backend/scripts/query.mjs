import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL);
const ws = "a6292a30-2d30-476f-9552-7292869880f5";

try {
  const agents =
    await sql`select id, role from agents where workspace_id = ${ws}`;
  const human = agents.find((a) => a.role === "human") ?? null;
  const groups =
    await sql`select id, name, created_at from groups where workspace_id = ${ws} order by created_at desc`;
  const groupIds = groups.map((g) => g.id);
  const members = groupIds.length
    ? await sql`select group_id, user_id, last_read_message_id from group_members where group_id in (${sql(groupIds)})`
    : [];
  const lastMsgs = groupIds.length
    ? await sql`select distinct on (group_id) group_id, id, sender_id, content, send_time from messages where group_id in (${sql(groupIds)}) order by group_id, send_time desc`
    : [];

  console.log(JSON.stringify({ agents, human, groups, members, lastMsgs }, null, 2));
} finally {
  await sql.end();
}
