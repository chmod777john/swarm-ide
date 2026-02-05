import { and, desc, eq, gt, inArray, ne, sql as dsql } from "drizzle-orm";

import { getDb } from "@/db";
import { agents, groupMembers, groups, messages, workspaces } from "@/db/schema";

type UUID = string;

function now() {
  return new Date();
}

function uuid(): UUID {
  return crypto.randomUUID();
}

function initialAgentHistory(input: {
  agentId: UUID;
  workspaceId: UUID;
  role: string;
  guidance?: string;
}) {
  const content =
    `You are an agent in an IM system.\n` +
    `Your agent_id is: ${input.agentId}.\n` +
    `Your workspace_id is: ${input.workspaceId}.\n` +
    `Your role is: ${input.role}.\n` +
    `Act strictly as this role when replying. Be concise and helpful.\n` +
    `Your replies are NOT automatically delivered to humans.\n` +
    `To send messages, you MUST call tools like send_group_message or send_direct_message.\n` +
    `If you need to coordinate with other agents, you may use tools like self, list_agents, create, send, list_groups, list_group_members, create_group, send_group_message, send_direct_message, and get_group_messages.`;

  const history: Array<{ role: "system"; content: string }> = [{ role: "system", content }];
  const guidance = (input.guidance ?? "").trim();
  if (guidance) {
    history.push({
      role: "system",
      content: `Additional instructions:\n${guidance}`,
    });
  }
  return JSON.stringify(history);
}

async function emitDbWrite(input: {
  workspaceId: UUID;
  table: string;
  action: "insert" | "update" | "delete";
  recordId?: UUID | null;
}) {
  try {
    const { getWorkspaceUIBus } = await import("@/runtime/ui-bus");
    getWorkspaceUIBus().emit(input.workspaceId, {
      event: "ui.db.write",
      data: {
        workspaceId: input.workspaceId,
        table: input.table,
        action: input.action,
        recordId: input.recordId ?? null,
      },
    });
  } catch {
    // best-effort only
  }
}

export const store = {
  async findLatestExactP2PGroupId(input: {
    workspaceId: UUID;
    memberA: UUID;
    memberB: UUID;
    preferredName?: string | null;
  }): Promise<UUID | null> {
    const db = getDb();
    const a = input.memberA;
    const b = input.memberB;
    if (!a || !b || a === b) return null;

    const rows = await db
      .select({
        id: groups.id,
        name: groups.name,
        createdAt: groups.createdAt,
        lastMessageTime: dsql<Date | null>`max(${messages.sendTime})`,
      })
      .from(groups)
      .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
      .leftJoin(messages, eq(messages.groupId, groups.id))
      .where(eq(groups.workspaceId, input.workspaceId))
      .groupBy(groups.id)
      .having(
        dsql`count(*) = 2 and sum(case when ${groupMembers.userId} = ${a} or ${groupMembers.userId} = ${b} then 1 else 0 end) = 2`
      );

    if (rows.length === 0) return null;

    const preferred = (input.preferredName ?? null) || null;
    rows.sort((x, y) => {
      const xName = x.name ?? null;
      const yName = y.name ?? null;
      const xMatch = preferred && xName === preferred ? 1 : 0;
      const yMatch = preferred && yName === preferred ? 1 : 0;
      if (xMatch !== yMatch) return yMatch - xMatch;

      const xNamed = xName ? 1 : 0;
      const yNamed = yName ? 1 : 0;
      if (xNamed !== yNamed) return yNamed - xNamed;

      const xUpdated = (x.lastMessageTime ?? x.createdAt).getTime();
      const yUpdated = (y.lastMessageTime ?? y.createdAt).getTime();
      if (xUpdated !== yUpdated) return yUpdated - xUpdated;

      return y.createdAt.getTime() - x.createdAt.getTime();
    });

    return rows[0]!.id;
  },

  // 修复点1：返回值类型从 UUID | null 改为 UUID（内部逻辑已确保不会返回 null）
  async mergeDuplicateExactP2PGroups(input: {
    workspaceId: UUID;
    memberA: UUID;
    memberB: UUID;
    preferredName?: string | null;
  }): Promise<UUID> {
    const db = getDb();
    const a = input.memberA;
    const b = input.memberB;
    if (!a || !b || a === b) {
      // 兜底：即使入参非法，也返回一个合法 UUID（避免返回 null），同时抛出明确错误
      throw new Error("memberA and memberB must be non-empty and different UUIDs");
    }

    const createdAt = now();

    return await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: groups.id,
          name: groups.name,
          createdAt: groups.createdAt,
          lastMessageTime: dsql<Date | null>`max(${messages.sendTime})`,
        })
        .from(groups)
        .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
        .leftJoin(messages, eq(messages.groupId, groups.id))
        .where(eq(groups.workspaceId, input.workspaceId))
        .groupBy(groups.id)
        .having(
          dsql`count(*) = 2 and sum(case when ${groupMembers.userId} = ${a} or ${groupMembers.userId} = ${b} then 1 else 0 end) = 2`
        );

      const preferred = (input.preferredName ?? null) || null;

      const pickBest = (candidates: typeof rows) => {
        const sorted = [...candidates];
        sorted.sort((x, y) => {
          const xName = x.name ?? null;
          const yName = y.name ?? null;
          const xMatch = preferred && xName === preferred ? 1 : 0;
          const yMatch = preferred && yName === preferred ? 1 : 0;
          if (xMatch !== yMatch) return yMatch - xMatch;

          const xNamed = xName ? 1 : 0;
          const yNamed = yName ? 1 : 0;
          if (xNamed !== yNamed) return yNamed - xNamed;

          const xUpdated = (x.lastMessageTime ?? x.createdAt).getTime();
          const yUpdated = (y.lastMessageTime ?? y.createdAt).getTime();
          if (xUpdated !== yUpdated) return yUpdated - xUpdated;

          return y.createdAt.getTime() - x.createdAt.getTime();
        });
        return sorted[0]!;
      };

      let keepId: UUID; // 移除 null 类型，确保必为合法 UUID

      if (rows.length === 0) {
        keepId = uuid();
        await tx.insert(groups).values({
          id: keepId,
          workspaceId: input.workspaceId,
          name: preferred || null,
          createdAt,
        });
        await tx.insert(groupMembers).values([
          { groupId: keepId, userId: a, lastReadMessageId: null, joinedAt: createdAt },
          { groupId: keepId, userId: b, lastReadMessageId: null, joinedAt: createdAt },
        ]).onConflictDoNothing();
        return keepId;
      }

      const best = pickBest(rows);
      keepId = best.id;

      const others = rows.filter((r) => r.id !== keepId).map((r) => r.id);
      for (const otherId of others) {
        await tx
          .update(messages)
          .set({ groupId: keepId })
          .where(and(eq(messages.workspaceId, input.workspaceId), eq(messages.groupId, otherId)));

        await tx.delete(groupMembers).where(eq(groupMembers.groupId, otherId));
        await tx.delete(groups).where(eq(groups.id, otherId));
      }

      if (preferred && (best.name ?? null) !== preferred) {
        await tx.update(groups).set({ name: preferred }).where(eq(groups.id, keepId));
      }

      return keepId;
    });
  },

  async listWorkspaces(): Promise<Array<{ id: UUID; name: string; createdAt: string }>> {
    const db = getDb();
    const rows = await db
      .select({ id: workspaces.id, name: workspaces.name, createdAt: workspaces.createdAt })
      .from(workspaces)
      .orderBy(desc(workspaces.createdAt));

    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  },

  async createAgent(input: {
    workspaceId: UUID;
    role: string;
    parentId?: UUID | null;
    llmHistory?: string;
    guidance?: string;
  }) {
    const db = getDb();
    const agentId = uuid();
    const createdAt = now();

    const workspace = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, input.workspaceId))
      .limit(1);
    if (workspace.length === 0) throw new Error("workspace not found");

    await db.insert(agents).values({
      id: agentId,
      workspaceId: input.workspaceId,
      role: input.role,
      parentId: input.parentId ?? null,
      llmHistory:
        input.llmHistory ??
        initialAgentHistory({
          agentId,
          workspaceId: input.workspaceId,
          role: input.role,
          guidance: input.guidance,
        }),
      createdAt,
    });

    await emitDbWrite({
      workspaceId: input.workspaceId,
      table: "agents",
      action: "insert",
      recordId: agentId,
    });

    return { id: agentId, role: input.role, createdAt: createdAt.toISOString() };
  },

  async listAgentsMeta(
    input: { workspaceId: UUID }
  ): Promise<Array<{ id: UUID; role: string; parentId: UUID | null; createdAt: string }>> {
    const db = getDb();
    const rows = await db
      .select({
        id: agents.id,
        role: agents.role,
        parentId: agents.parentId,
        createdAt: agents.createdAt,
      })
      .from(agents)
      .where(eq(agents.workspaceId, input.workspaceId))
      .orderBy(desc(agents.createdAt));

    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  },

  async getDefaultHumanAgentId(input: { workspaceId: UUID }): Promise<UUID | null> {
    const agents = await this.listAgentsMeta({ workspaceId: input.workspaceId });
    return agents.find((a) => a.role === "human")?.id ?? null;
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
          llmHistory: initialAgentHistory({
            agentId: humanAgentId,
            workspaceId,
            role: "human",
          }),
          createdAt,
        },
        {
          id: assistantAgentId,
          workspaceId,
          role: "assistant",
          parentId: null,
          llmHistory: initialAgentHistory({
            agentId: assistantAgentId,
            workspaceId,
            role: "assistant",
          }),
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

    await emitDbWrite({
      workspaceId,
      table: "workspaces",
      action: "insert",
      recordId: workspaceId,
    });
    await emitDbWrite({
      workspaceId,
      table: "agents",
      action: "insert",
    });
    await emitDbWrite({
      workspaceId,
      table: "groups",
      action: "insert",
      recordId: defaultGroupId,
    });
    await emitDbWrite({
      workspaceId,
      table: "group_members",
      action: "insert",
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

    let createdHuman = false;
    let createdAssistant = false;
    let createdGroup = false;

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
          llmHistory: initialAgentHistory({
            agentId: humanAgentId,
            workspaceId: input.workspaceId,
            role: "human",
          }),
          createdAt,
        });
        createdHuman = true;
      }

      if (!assistantAgentId) {
        assistantAgentId = uuid();
        await tx.insert(agents).values({
          id: assistantAgentId,
          workspaceId: input.workspaceId,
          role: "assistant",
          parentId: null,
          llmHistory: initialAgentHistory({
            agentId: assistantAgentId,
            workspaceId: input.workspaceId,
            role: "assistant",
          }),
          createdAt,
        });
        createdAssistant = true;
      }

      // 确保 humanAgentId 和 assistantAgentId 非空（兜底，避免后续报错）
      if (!humanAgentId || !assistantAgentId) {
        throw new Error("Failed to create or retrieve human/assistant agent");
      }

      const candidate = await tx
        .select({ id: groups.id })
        .from(groups)
        .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
        .where(eq(groups.workspaceId, input.workspaceId))
        .groupBy(groups.id)
        .having(
          dsql`count(*) = 2 and sum(case when ${groupMembers.userId} = ${humanAgentId} or ${groupMembers.userId} = ${assistantAgentId} then 1 else 0 end) = 2`
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
        createdGroup = true;
      }

      return { workspaceId: input.workspaceId, humanAgentId, assistantAgentId, defaultGroupId };
    });

    if (createdHuman) {
      await emitDbWrite({
        workspaceId: input.workspaceId,
        table: "agents",
        action: "insert",
      });
    }
    if (createdAssistant) {
      await emitDbWrite({
        workspaceId: input.workspaceId,
        table: "agents",
        action: "insert",
      });
    }
    if (createdGroup) {
      await emitDbWrite({
        workspaceId: input.workspaceId,
        table: "groups",
        action: "insert",
        recordId: result.defaultGroupId,
      });
      await emitDbWrite({
        workspaceId: input.workspaceId,
        table: "group_members",
        action: "insert",
        recordId: result.defaultGroupId,
      });
    }

    return result;
  },

  async createSubAgentWithP2P(input: {
    workspaceId: UUID;
    creatorId: UUID;
    role: string;
    guidance?: string;
  }) {
    const db = getDb();
    const createdAt = now();
    const agentId = uuid();
    const groupId = uuid();

    const defaults = await store.ensureWorkspaceDefaults({ workspaceId: input.workspaceId });
    const humanAgentId = defaults.humanAgentId;

    // 兜底：确保 humanAgentId 非空
    if (!humanAgentId) {
      throw new Error("Human agent not found in workspace defaults");
    }

    const workspace = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, input.workspaceId))
      .limit(1);
    if (workspace.length === 0) throw new Error("workspace not found");

    await db.transaction(async (tx) => {
      await tx.insert(agents).values({
        id: agentId,
        workspaceId: input.workspaceId,
        role: input.role,
        parentId: input.creatorId,
        llmHistory: initialAgentHistory({
          agentId,
          workspaceId: input.workspaceId,
          role: input.role,
          guidance: input.guidance,
        }),
        createdAt,
      });

      await tx.insert(groups).values({
        id: groupId,
        workspaceId: input.workspaceId,
        name: input.role,
        createdAt,
      });

      await tx.insert(groupMembers).values([
        {
          groupId,
          userId: humanAgentId,
          lastReadMessageId: null,
          joinedAt: createdAt,
        },
        {
          groupId,
          userId: agentId,
          lastReadMessageId: null,
          joinedAt: createdAt,
        },
      ]);
    });

    await emitDbWrite({
      workspaceId: input.workspaceId,
      table: "agents",
      action: "insert",
      recordId: agentId,
    });
    await emitDbWrite({
      workspaceId: input.workspaceId,
      table: "groups",
      action: "insert",
      recordId: groupId,
    });
    await emitDbWrite({
      workspaceId: input.workspaceId,
      table: "group_members",
      action: "insert",
      recordId: groupId,
    });

    return { agentId, groupId, createdAt: createdAt.toISOString() };
  },

  async addGroupMembers(input: { groupId: UUID; userIds: UUID[] }) {
    const db = getDb();
    const joinedAt = now();

    if (input.userIds.length === 0) return;

    const group = await db
      .select({ workspaceId: groups.workspaceId })
      .from(groups)
      .where(eq(groups.id, input.groupId))
      .limit(1);
    if (group.length === 0) throw new Error("group not found");

    await db
      .insert(groupMembers)
      .values(
        input.userIds.map((userId) => ({
          groupId: input.groupId,
          userId,
          lastReadMessageId: null,
          joinedAt,
        }))
      )
      .onConflictDoNothing();

    await emitDbWrite({
      workspaceId: group[0]!.workspaceId,
      table: "group_members",
      action: "insert",
      recordId: input.groupId,
    });
  },

  async createGroup(input: { workspaceId: UUID; memberIds: UUID[]; name?: string }) {
    const db = getDb();
    const groupId = uuid();
    const createdAt = now();

    // 兜底：确保 memberIds 非空且去重
    const validMemberIds = [...new Set(input.memberIds)].filter(Boolean);
    if (validMemberIds.length === 0) {
      throw new Error("memberIds must contain at least one valid UUID");
    }

    await db.transaction(async (tx) => {
      await tx.insert(groups).values({
        id: groupId,
        workspaceId: input.workspaceId,
        name: input.name ?? null,
        createdAt,
      });

      await tx.insert(groupMembers).values(
        validMemberIds.map((userId) => ({
          groupId,
          userId,
          lastReadMessageId: null,
          joinedAt: createdAt,
        }))
      ).onConflictDoNothing();
    });

    await emitDbWrite({
      workspaceId: input.workspaceId,
      table: "groups",
      action: "insert",
      recordId: groupId,
    });
    await emitDbWrite({
      workspaceId: input.workspaceId,
      table: "group_members",
      action: "insert",
      recordId: groupId,
    });

    return { id: groupId, name: input.name ?? null, createdAt: createdAt.toISOString() };
  },

  async findLatestExactGroupId(input: { workspaceId: UUID; memberIds: UUID[] }): Promise<UUID | null> {
    const db = getDb();
    const ids = [...new Set(input.memberIds)].filter(Boolean);
    if (ids.length === 0) return null;

    const rows = await db
      .select({
        id: groups.id,
        createdAt: groups.createdAt,
        lastMessageTime: dsql<Date | null>`max(${messages.sendTime})`,
      })
      .from(groups)
      .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
      .leftJoin(messages, eq(messages.groupId, groups.id))
      .where(and(eq(groups.workspaceId, input.workspaceId), inArray(groupMembers.userId, ids)))
      .groupBy(groups.id)
      .having(
        dsql`count(distinct ${groupMembers.userId}) = ${ids.length} and count(*) = ${ids.length}`
      )
      .orderBy(desc(dsql`coalesce(max(${messages.sendTime}), ${groups.createdAt})`))
      .limit(1);

    return rows[0]?.id ?? null;
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

    await emitDbWrite({
      workspaceId: group[0]!.workspaceId,
      table: "messages",
      action: "insert",
      recordId: messageId,
    });

    return { id: messageId, sendTime: sendTime.toISOString() };
  },

  async sendDirectMessage(input: {
    workspaceId: UUID;
    fromId: UUID;
    toId: UUID;
    observerHumanId?: UUID | null;
    content: string;
    contentType?: string;
    groupName?: string | null;
    newThread?: boolean;
  }) {
    const memberIds = [
      input.fromId,
      input.toId,
      input.observerHumanId && input.observerHumanId !== input.fromId && input.observerHumanId !== input.toId
        ? input.observerHumanId
        : null,
    ].filter(Boolean) as UUID[];

    // 兜底：确保 memberIds 有效
    if (memberIds.length === 0) {
      throw new Error("memberIds must contain at least one valid UUID");
    }

    let groupId: UUID;
    let channel: "new_thread" | "new_group" | "reuse_existing_group";
    if (input.newThread === true) {
      groupId = (
        await this.createGroup({
          workspaceId: input.workspaceId,
          memberIds,
          name: input.groupName ?? undefined,
        })
      ).id;
      channel = "new_thread";
    } else if (memberIds.length === 2) {
      const existing = await this.findLatestExactP2PGroupId({
        workspaceId: input.workspaceId,
        memberA: memberIds[0]!,
        memberB: memberIds[1]!,
        preferredName: input.groupName ?? null,
      });
      // 修复点2：mergeDuplicateExactP2PGroups 已返回非空 UUID，无需 ?? 兜底（消除类型歧义）
      groupId = await this.mergeDuplicateExactP2PGroups({
        workspaceId: input.workspaceId,
        memberA: memberIds[0]!,
        memberB: memberIds[1]!,
        preferredName: input.groupName ?? null,
      });
      channel = existing ? "reuse_existing_group" : "new_group";
    } else {
      const existing = await this.findLatestExactGroupId({
        workspaceId: input.workspaceId,
        memberIds,
      });
      groupId =
        existing ??
        (
          await this.createGroup({
            workspaceId: input.workspaceId,
            memberIds,
            name: input.groupName ?? undefined,
          })
        ).id;
      channel = existing ? "reuse_existing_group" : "new_group";
    }

    const message = await this.sendMessage({
      groupId,
      senderId: input.fromId,
      content: input.content,
      contentType: input.contentType ?? "text",
    });

    return { groupId, messageId: message.id, sendTime: message.sendTime, channel };
  },

  async getGroupWorkspaceId(input: { groupId: UUID }): Promise<UUID> {
    const db = getDb();
    const group = await db
      .select({ workspaceId: groups.workspaceId })
      .from(groups)
      .where(eq(groups.id, input.groupId))
      .limit(1);
    if (group.length === 0) throw new Error("group not found");
    return group[0]!.workspaceId;
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

    const group = await db
      .select({ workspaceId: groups.workspaceId })
      .from(groups)
      .where(eq(groups.id, input.groupId))
      .limit(1);
    if (group.length > 0) {
      await emitDbWrite({
        workspaceId: group[0]!.workspaceId,
        table: "group_members",
        action: "update",
        recordId: input.groupId,
      });
    }
  },

  async markGroupReadToMessage(input: { groupId: UUID; readerId: UUID; messageId: UUID }) {
    const db = getDb();
    await db
      .update(groupMembers)
      .set({ lastReadMessageId: input.messageId })
      .where(
        dsql`${groupMembers.groupId} = ${input.groupId} and ${groupMembers.userId} = ${input.readerId}`
      );

    const group = await db
      .select({ workspaceId: groups.workspaceId })
      .from(groups)
      .where(eq(groups.id, input.groupId))
      .limit(1);
    if (group.length > 0) {
      await emitDbWrite({
        workspaceId: group[0]!.workspaceId,
        table: "group_members",
        action: "update",
        recordId: input.groupId,
      });
    }
  },

  async listGroupMemberIds(input: { groupId: UUID }): Promise<UUID[]> {
    const db = getDb();
    const rows = await db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, input.groupId));
    return rows.map((r) => r.userId);
  },

  async listAgents(
    input?: { workspaceId?: UUID }
  ): Promise<Array<{ id: UUID; workspaceId: UUID; role: string; llmHistory: string }>> {
    const db = getDb();
    const rows = await db
      .select({
        id: agents.id,
        workspaceId: agents.workspaceId,
        role: agents.role,
        llmHistory: agents.llmHistory,
      })
      .from(agents)
      .where(input?.workspaceId ? eq(agents.workspaceId, input.workspaceId) : undefined)
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

  async setAgentHistory(input: { agentId: UUID; llmHistory: string; workspaceId?: UUID }) {
    const db = getDb();
    await db.update(agents).set({ llmHistory: input.llmHistory }).where(eq(agents.id, input.agentId));

    const workspaceId =
      input.workspaceId ??
      (
        await db
          .select({ workspaceId: agents.workspaceId })
          .from(agents)
          .where(eq(agents.id, input.agentId))
          .limit(1)
      )[0]?.workspaceId;
    if (workspaceId) {
      await emitDbWrite({
        workspaceId,
        table: "agents",
        action: "update",
        recordId: input.agentId,
      });
    }
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
    const viewerRole =
      input.agentId
        ? (
            await db
              .select({ role: agents.role })
              .from(agents)
              .where(eq(agents.id, input.agentId))
              .limit(1)
          )[0]?.role ?? null
        : null;

    const rows = input.agentId
      ? await db
          .select({
            id: groups.id,
            name: groups.name,
            workspaceId: groups.workspaceId,
            contextTokens: groups.contextTokens,
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
            contextTokens: groups.contextTokens,
            createdAt: groups.createdAt,
          })
          .from(groups)
          .where(input.workspaceId ? eq(groups.workspaceId, input.workspaceId) : undefined)
          .orderBy(desc(groups.createdAt));

    const result = [];
    for (const g of rows) {
      const members = await db
        .select({ userId: groupMembers.userId })
        .from(groupMembers)
        .where(eq(groupMembers.groupId, g.id));

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
        memberIds: members.map((m) => m.userId),
        unreadCount,
        contextTokens: g.contextTokens ?? 0,
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

  async setGroupContextTokens(input: { groupId: UUID; tokens: number }) {
    const db = getDb();
    const group = await db
      .select({ workspaceId: groups.workspaceId, contextTokens: groups.contextTokens })
      .from(groups)
      .where(eq(groups.id, input.groupId))
      .limit(1);
    if (group.length === 0) throw new Error("group not found");

    await db.update(groups).set({ contextTokens: input.tokens }).where(eq(groups.id, input.groupId));

    await emitDbWrite({
      workspaceId: group[0]!.workspaceId,
      table: "groups",
      action: "update",
      recordId: input.groupId,
    });

    return { contextTokens: input.tokens };
  },

  async listRecentWorkspaceMessages(input: { workspaceId: UUID; limit?: number }) {
    const db = getDb();
    const limit = Math.max(1, Math.min(5000, input.limit ?? 2000));
    const rows = await db
      .select({
        id: messages.id,
        groupId: messages.groupId,
        senderId: messages.senderId,
        sendTime: messages.sendTime,
      })
      .from(messages)
      .where(eq(messages.workspaceId, input.workspaceId))
      .orderBy(desc(messages.sendTime))
      .limit(limit);

    return rows.map((m) => ({
      id: m.id,
      groupId: m.groupId,
      senderId: m.senderId,
      sendTime: m.sendTime.toISOString(),
    }));
  },

  async deleteAgent(input: { agentId: UUID; workspaceId: UUID }) {
    const db = getDb();
    
    // Check if agent exists
    const agent = await db
      .select({ id: agents.id, role: agents.role })
      .from(agents)
      .where(and(eq(agents.id, input.agentId), eq(agents.workspaceId, input.workspaceId)))
      .limit(1);
    
    if (agent.length === 0) {
      throw new Error(`Agent not found: ${input.agentId} in workspace ${input.workspaceId}`);
    }

    // Step 1: Recursively delete all child agents created by this agent
    const childAgents = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(
        eq(agents.parentId, input.agentId),
        eq(agents.workspaceId, input.workspaceId)
      ));
    
    for (const child of childAgents) {
      await this.deleteAgent({ 
        agentId: child.id, 
        workspaceId: input.workspaceId 
      });
    }

    // Step 2: Find and delete the agent's dedicated group (group with name = agent's role)
    // This group is created when the agent is created via createSubAgentWithP2P
    // Find group by matching: same name as agent's role AND agent is a member of it
    const dedicatedGroups = await db
      .select({ id: groups.id })
      .from(groups)
      .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
      .where(and(
        eq(groups.workspaceId, input.workspaceId),
        eq(groups.name, agent[0]!.role),
        eq(groupMembers.userId, input.agentId)
      ))
      .limit(1);
    
    if (dedicatedGroups.length > 0) {
      const groupId = dedicatedGroups[0]!.id;
      
      // Delete all messages in this group
      await db.delete(messages)
        .where(eq(messages.groupId, groupId));
      
      // Delete group members
      await db.delete(groupMembers)
        .where(eq(groupMembers.groupId, groupId));
      
      // Delete the group itself
      await db.delete(groups)
        .where(eq(groups.id, groupId));
    }

    // Step 3: Delete agent from all other group memberships
    // (Keep this for cleaning up membership in shared groups like default P2P group)
    await db
      .delete(groupMembers)
      .where(eq(groupMembers.userId, input.agentId));
    
    // Step 4: Delete the agent record
    await db
      .delete(agents)
      .where(and(eq(agents.id, input.agentId), eq(agents.workspaceId, input.workspaceId)));
    
    // Emit database write event
    await emitDbWrite({
      workspaceId: input.workspaceId,
      table: "agents",
      action: "delete",
      recordId: input.agentId,
    });

    return { deleted: true, agentId: input.agentId };
  },
};
