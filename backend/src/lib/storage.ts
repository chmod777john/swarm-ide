import { and, desc, eq, gt, ne, sql as dsql } from "drizzle-orm";

import { getDb } from "@/db";
import { agents, groupMembers, groups, messages, workspaces } from "@/db/schema";

type UUID = string;

function now() {
  return new Date();
}

function uuid(): UUID {
  return crypto.randomUUID();
}

export const store = {
  async listWorkspaces(): Promise<Array<{ id: UUID; name: string; createdAt: string }>> {
    const db = getDb();
    const rows = await db
      .select({ id: workspaces.id, name: workspaces.name, createdAt: workspaces.createdAt })
      .from(workspaces)
      .orderBy(desc(workspaces.createdAt));

    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  },

  async createWorkspaceWithDefaults(input: { name: string }) {
    const db = getDb();
    const workspaceId = uuid();
    const humanAgentId = uuid();
    const assistantAgentId = uuid();
    const defaultGroupId = uuid();
    const createdAt = now();

    await db.transaction(async (tx) => {
      await tx.insert(workspaces).values({
        id: workspaceId,
        name: input.name,
        createdAt,
      });

      await tx.insert(agents).values([
        {
          id: humanAgentId,
          workspaceId,
          role: "human",
          parentId: null,
          llmHistory: "[]",
          createdAt,
        },
        {
          id: assistantAgentId,
          workspaceId,
          role: "assistant",
          parentId: null,
          llmHistory: "[]",
          createdAt,
        },
      ]);

      await tx.insert(groups).values({
        id: defaultGroupId,
        workspaceId,
        name: null,
        createdAt,
      });

      await tx.insert(groupMembers).values([
        {
          groupId: defaultGroupId,
          userId: humanAgentId,
          lastReadMessageId: null,
          joinedAt: createdAt,
        },
        {
          groupId: defaultGroupId,
          userId: assistantAgentId,
          lastReadMessageId: null,
          joinedAt: createdAt,
        },
      ]);
    });

    return { workspaceId, humanAgentId, assistantAgentId, defaultGroupId };
  },

  async ensureWorkspaceDefaults(input: { workspaceId: UUID }) {
    const db = getDb();
    const createdAt = now();

    const workspace = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, input.workspaceId))
      .limit(1);
    if (workspace.length === 0) throw new Error("workspace not found");

    const result = await db.transaction(async (tx) => {
      const existingAgents = await tx
        .select({ id: agents.id, role: agents.role })
        .from(agents)
        .where(eq(agents.workspaceId, input.workspaceId));

      let humanAgentId = existingAgents.find((a) => a.role === "human")?.id ?? null;
      let assistantAgentId =
        existingAgents.find((a) => a.role === "assistant")?.id ?? null;

      if (!humanAgentId) {
        humanAgentId = uuid();
        await tx.insert(agents).values({
          id: humanAgentId,
          workspaceId: input.workspaceId,
          role: "human",
          parentId: null,
          llmHistory: "[]",
          createdAt,
        });
      }

      if (!assistantAgentId) {
        assistantAgentId = uuid();
        await tx.insert(agents).values({
          id: assistantAgentId,
          workspaceId: input.workspaceId,
          role: "assistant",
          parentId: null,
          llmHistory: "[]",
          createdAt,
        });
      }

      const candidate = await tx
        .select({ id: groups.id })
        .from(groups)
        .where(
          dsql`${groups.workspaceId} = ${input.workspaceId} and ${groups.id} in (
            select ${groupMembers.groupId}
            from ${groupMembers}
            where (${groupMembers.userId} = ${humanAgentId} or ${groupMembers.userId} = ${assistantAgentId})
            group by ${groupMembers.groupId}
            having count(*) = 2 and count(distinct ${groupMembers.userId}) = 2
          )`
        )
        .orderBy(desc(groups.createdAt))
        .limit(1);

      let defaultGroupId = candidate[0]?.id ?? null;

      if (!defaultGroupId) {
        defaultGroupId = uuid();
        await tx.insert(groups).values({
          id: defaultGroupId,
          workspaceId: input.workspaceId,
          name: null,
          createdAt,
        });

        await tx.insert(groupMembers).values([
          {
            groupId: defaultGroupId,
            userId: humanAgentId,
            lastReadMessageId: null,
            joinedAt: createdAt,
          },
          {
            groupId: defaultGroupId,
            userId: assistantAgentId,
            lastReadMessageId: null,
            joinedAt: createdAt,
          },
        ]);
      }

      return { workspaceId: input.workspaceId, humanAgentId, assistantAgentId, defaultGroupId };
    });

    return result;
  },

  async createGroup(input: { workspaceId: UUID; memberIds: UUID[]; name?: string }) {
    const db = getDb();
    const groupId = uuid();
    const createdAt = now();

    await db.transaction(async (tx) => {
      await tx.insert(groups).values({
        id: groupId,
        workspaceId: input.workspaceId,
        name: input.name ?? null,
        createdAt,
      });

      await tx.insert(groupMembers).values(
        input.memberIds.map((userId) => ({
          groupId,
          userId,
          lastReadMessageId: null,
          joinedAt: createdAt,
        }))
      );
    });

    return { id: groupId, name: input.name ?? null, createdAt: createdAt.toISOString() };
  },

  async listMessages(input: { groupId: UUID }) {
    const db = getDb();
    const rows = await db
      .select({
        id: messages.id,
        senderId: messages.senderId,
        content: messages.content,
        contentType: messages.contentType,
        sendTime: messages.sendTime,
      })
      .from(messages)
      .where(eq(messages.groupId, input.groupId))
      .orderBy(messages.sendTime);

    return rows.map((m) => ({ ...m, sendTime: m.sendTime.toISOString() }));
  },

  async sendMessage(input: {
    groupId: UUID;
    senderId: UUID;
    content: string;
    contentType: string;
  }) {
    const db = getDb();
    const group = await db
      .select({ workspaceId: groups.workspaceId })
      .from(groups)
      .where(eq(groups.id, input.groupId))
      .limit(1);

    if (group.length === 0) throw new Error("group not found");

    const messageId = uuid();
    const sendTime = now();

    await db.insert(messages).values({
      id: messageId,
      workspaceId: group[0]!.workspaceId,
      groupId: input.groupId,
      senderId: input.senderId,
      contentType: input.contentType,
      content: input.content,
      sendTime,
    });

    return { id: messageId, sendTime: sendTime.toISOString() };
  },

  async markGroupRead(input: { groupId: UUID; readerId: UUID }) {
    const db = getDb();
    const last = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.groupId, input.groupId))
      .orderBy(desc(messages.sendTime))
      .limit(1);

    await db
      .update(groupMembers)
      .set({ lastReadMessageId: last[0]?.id ?? null })
      .where(
        dsql`${groupMembers.groupId} = ${input.groupId} and ${groupMembers.userId} = ${input.readerId}`
      );
  },

  async markGroupReadToMessage(input: { groupId: UUID; readerId: UUID; messageId: UUID }) {
    const db = getDb();
    await db
      .update(groupMembers)
      .set({ lastReadMessageId: input.messageId })
      .where(
        dsql`${groupMembers.groupId} = ${input.groupId} and ${groupMembers.userId} = ${input.readerId}`
      );
  },

  async listGroupMemberIds(input: { groupId: UUID }): Promise<UUID[]> {
    const db = getDb();
    const rows = await db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, input.groupId));
    return rows.map((r) => r.userId);
  },

  async listAgents(): Promise<Array<{ id: UUID; workspaceId: UUID; role: string; llmHistory: string }>> {
    const db = getDb();
    const rows = await db
      .select({
        id: agents.id,
        workspaceId: agents.workspaceId,
        role: agents.role,
        llmHistory: agents.llmHistory,
      })
      .from(agents)
      .orderBy(desc(agents.createdAt));

    return rows;
  },

  async getAgent(input: { agentId: UUID }): Promise<{ id: UUID; role: string; llmHistory: string }> {
    const db = getDb();
    const rows = await db
      .select({ id: agents.id, role: agents.role, llmHistory: agents.llmHistory })
      .from(agents)
      .where(eq(agents.id, input.agentId))
      .limit(1);
    if (rows.length === 0) throw new Error("agent not found");
    return rows[0]!;
  },

  async getAgentRole(input: { agentId: UUID }): Promise<string> {
    const agent = await this.getAgent(input);
    return agent.role;
  },

  async setAgentHistory(input: { agentId: UUID; llmHistory: string }) {
    const db = getDb();
    await db.update(agents).set({ llmHistory: input.llmHistory }).where(eq(agents.id, input.agentId));
  },

  async listUnreadByGroup(input: { agentId: UUID }): Promise<
    Array<{
      groupId: UUID;
      messages: Array<{
        id: UUID;
        senderId: UUID;
        contentType: string;
        content: string;
        sendTime: string;
      }>;
    }>
  > {
    const db = getDb();
    const memberships = await db
      .select({ groupId: groupMembers.groupId, lastReadMessageId: groupMembers.lastReadMessageId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, input.agentId));

    const result = [];

    for (const m of memberships) {
      let cutoff = new Date(0);
      if (m.lastReadMessageId) {
        const last = await db
          .select({ sendTime: messages.sendTime })
          .from(messages)
          .where(eq(messages.id, m.lastReadMessageId))
          .limit(1);
        cutoff = last[0]?.sendTime ?? cutoff;
      }

      const rows = await db
        .select({
          id: messages.id,
          senderId: messages.senderId,
          content: messages.content,
          contentType: messages.contentType,
          sendTime: messages.sendTime,
        })
        .from(messages)
        .where(
          and(eq(messages.groupId, m.groupId), gt(messages.sendTime, cutoff), ne(messages.senderId, input.agentId))
        )
        .orderBy(messages.sendTime);

      if (rows.length === 0) continue;

      result.push({
        groupId: m.groupId,
        messages: rows.map((row) => ({ ...row, sendTime: row.sendTime.toISOString() })),
      });
    }

    return result;
  },

  async listGroups(input: { workspaceId?: UUID; agentId?: UUID }) {
    const db = getDb();
    const rows = input.agentId
      ? await db
          .select({
            id: groups.id,
            name: groups.name,
            workspaceId: groups.workspaceId,
            createdAt: groups.createdAt,
          })
          .from(groups)
          .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
          .where(
            input.workspaceId
              ? and(eq(groups.workspaceId, input.workspaceId), eq(groupMembers.userId, input.agentId))
              : eq(groupMembers.userId, input.agentId)
          )
          .orderBy(desc(groups.createdAt))
      : await db
          .select({
            id: groups.id,
            name: groups.name,
            workspaceId: groups.workspaceId,
            createdAt: groups.createdAt,
          })
          .from(groups)
          .where(input.workspaceId ? eq(groups.workspaceId, input.workspaceId) : undefined)
          .orderBy(desc(groups.createdAt));

    const result = [];
    for (const g of rows) {
      const lastMessage = await db
        .select({
          id: messages.id,
          senderId: messages.senderId,
          content: messages.content,
          contentType: messages.contentType,
          sendTime: messages.sendTime,
        })
        .from(messages)
        .where(eq(messages.groupId, g.id))
        .orderBy(desc(messages.sendTime))
        .limit(1);

      let unreadCount = 0;
      if (input.agentId) {
        const state = await db
          .select({ lastReadMessageId: groupMembers.lastReadMessageId })
          .from(groupMembers)
          .where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.userId, input.agentId)))
          .limit(1);

        const lastReadId = state[0]?.lastReadMessageId ?? null;
        if (!lastReadId) {
          const countRow = await db
            .select({ c: dsql<number>`count(*)` })
            .from(messages)
            .where(and(eq(messages.groupId, g.id), ne(messages.senderId, input.agentId)));
          unreadCount = Number(countRow[0]?.c ?? 0);
        } else {
          const lastRead = await db
            .select({ sendTime: messages.sendTime })
            .from(messages)
            .where(eq(messages.id, lastReadId))
            .limit(1);

          const cutoff = lastRead[0]?.sendTime ?? new Date(0);
          const countRow = await db
            .select({ c: dsql<number>`count(*)` })
            .from(messages)
            .where(
              and(eq(messages.groupId, g.id), gt(messages.sendTime, cutoff), ne(messages.senderId, input.agentId))
            );
          unreadCount = Number(countRow[0]?.c ?? 0);
        }
      }

      const updatedAt = lastMessage[0]?.sendTime ?? g.createdAt;

      result.push({
        id: g.id,
        name: g.name,
        unreadCount,
        lastMessage: lastMessage[0]
          ? {
              content: lastMessage[0].content,
              contentType: lastMessage[0].contentType,
              sendTime: lastMessage[0].sendTime.toISOString(),
              senderId: lastMessage[0].senderId,
            }
          : undefined,
        updatedAt: updatedAt.toISOString(),
        createdAt: g.createdAt.toISOString(),
      });
    }

    return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
};
