"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

type UUID = string;

type WorkspaceDefaults = {
  workspaceId: UUID;
  humanAgentId: UUID;
  assistantAgentId: UUID;
  defaultGroupId: UUID;
};

type AgentMeta = {
  id: UUID;
  role: string;
  parentId: UUID | null;
  createdAt: string;
};

type Group = {
  id: UUID;
  name: string | null;
  memberIds: UUID[];
  unreadCount: number;
  lastMessage?: {
    content: string;
    contentType: string;
    sendTime: string;
    senderId: UUID;
  };
  updatedAt: string;
  createdAt: string;
};

type Message = {
  id: UUID;
  senderId: UUID;
  content: string;
  contentType: string;
  sendTime: string;
};

type AgentStreamEvent =
  | {
      id: number;
      at: number;
      event: "agent.stream";
      data: {
        kind: "reasoning" | "content" | "tool_calls" | "tool_result";
        delta: string;
        tool_call_id?: string;
        tool_call_name?: string;
      };
    }
  | {
      id: number;
      at: number;
      event: "agent.wakeup";
      data: { agentId: string; reason?: string | null };
    }
  | {
      id: number;
      at: number;
      event: "agent.unread";
      data: { agentId: string; batches: Array<{ groupId: string; messageIds: string[] }> };
    }
  | { id: number; at: number; event: "agent.done"; data: { finishReason?: string | null } }
  | { id: number; at: number; event: "agent.error"; data: { message: string } };

const SESSION_KEY = "agent-wechat.session.v1";

function loadSession(): WorkspaceDefaults | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WorkspaceDefaults;
  } catch {
    return null;
  }
}

function saveSession(session: WorkspaceDefaults) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} ${text}`);
  }
  return (await res.json()) as T;
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function cx(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

export default function IMPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading...</div>}>
      <IMPageInner />
    </Suspense>
  );
}

function IMPageInner() {
  const searchParams = useSearchParams();
  const workspaceOverrideId = searchParams.get("workspaceId");
  const [session, setSession] = useState<WorkspaceDefaults | null>(() => null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [agents, setAgents] = useState<AgentMeta[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"boot" | "groups" | "messages" | "send" | "idle">("boot");
  const [error, setError] = useState<string | null>(null);

  const [contentStream, setContentStream] = useState("");
  const [reasoningStream, setReasoningStream] = useState("");
  const [toolStream, setToolStream] = useState("");
  const [llmHistory, setLlmHistory] = useState("");
  const [agentError, setAgentError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const activeGroupIdRef = useRef<string | null>(null);
  const streamAgentIdRef = useRef<string | null>(null);
  const toolCallBuffersRef = useRef<Map<string, string>>(new Map());
  const toolResultBuffersRef = useRef<Map<string, string>>(new Map());
  const uiEsRef = useRef<EventSource | null>(null);
  const llmHistoryReqIdRef = useRef(0);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedToAgentId, setSelectedToAgentId] = useState<UUID | null>(null);
  const [selectedGroupMemberIds, setSelectedGroupMemberIds] = useState<UUID[]>([]);
  const [searchResults, setSearchResults] = useState<{ agents: AgentMeta[]; groups: Group[] }>({
    agents: [],
    groups: [],
  });
  const openingConversationRef = useRef<UUID | null>(null);

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId) ?? null,
    [groups, activeGroupId]
  );

  const agentRoleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) map.set(a.id, a.role);
    return map;
  }, [agents]);

  const getGroupLabel = useCallback(
    (g: Group | null | undefined) => {
      if (!g) return "Group";
      if (g.name) return g.name;
      if (g.id === session?.defaultGroupId) return "P2P 人类↔助手";

      const memberRoles = g.memberIds
        .filter((id) => id !== session?.humanAgentId)
        .map((id) => agentRoleById.get(id) ?? id.slice(0, 8));

      if (memberRoles.length === 1) return `P2P 人类↔${memberRoles[0]}`;
      if (memberRoles.length === 2) return `${memberRoles[0]} ↔ ${memberRoles[1]}`;
      if (memberRoles.length > 2) return `Group (${memberRoles.length})`;
      return "Group";
    },
    [agentRoleById, session?.defaultGroupId, session?.humanAgentId]
  );

  const humanVisibleAgents = useMemo(() => {
    if (!session) return [];
    return agents.filter((a) => a.id !== session.humanAgentId);
  }, [agents, session]);

  const searchAgents = useMemo(() => {
    if (!session) return [];
    if (!searchOpen) return humanVisibleAgents;
    return searchResults.agents.filter((a) => a.id !== session.humanAgentId);
  }, [humanVisibleAgents, searchOpen, searchResults.agents, session]);

  const searchGroups = useMemo(() => {
    if (!searchOpen) return [];
    return searchResults.groups;
  }, [searchOpen, searchResults.groups]);

  const streamAgentId = useMemo(() => {
    if (!session) return null;
    if (!activeGroupId) return session.assistantAgentId;
    const group = groups.find((g) => g.id === activeGroupId);
    if (!group) return session.assistantAgentId;
    return group.memberIds.find((id) => id !== session.humanAgentId) ?? session.assistantAgentId;
  }, [activeGroupId, groups, session]);

  const refreshAgents = useCallback(async (s: WorkspaceDefaults) => {
    const { agents } = await api<{ agents: AgentMeta[] }>(
      `/api/agents?workspaceId=${encodeURIComponent(s.workspaceId)}&meta=true`
    );
    setAgents(agents);
  }, []);

  const formatLlmHistory = useCallback((raw: string) => {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }, []);

  const refreshLlmHistory = useCallback(
    async (agentId: string) => {
      const reqId = (llmHistoryReqIdRef.current += 1);
      try {
        const res = await api<{ llmHistory: string }>(`/api/agents/${agentId}`);
        if (reqId !== llmHistoryReqIdRef.current) return;
        setLlmHistory(formatLlmHistory(res.llmHistory));
      } catch (e) {
        if (reqId !== llmHistoryReqIdRef.current) return;
        setLlmHistory(
          e instanceof Error ? `(failed to load llm_history: ${e.message})` : "(failed to load llm_history)"
        );
      }
    },
    [formatLlmHistory]
  );

  const bootstrap = useCallback(async (overrideWorkspaceId: string | null) => {
    setError(null);
    setAgentError(null);
    setStatus("boot");

    setGroups([]);
    setMessages([]);
    setLlmHistory("");
    esRef.current?.close();

    if (overrideWorkspaceId) {
      const ensured = await api<WorkspaceDefaults>(
        `/api/workspaces/${overrideWorkspaceId}/defaults`
      );
      saveSession(ensured);
      setSession(ensured);
      setActiveGroupId(ensured.defaultGroupId);
      setStatus("idle");
      void refreshAgents(ensured);
      return;
    }

    const existing = loadSession();
    if (existing) {
      try {
        const ensured = await api<WorkspaceDefaults>(
          `/api/workspaces/${existing.workspaceId}/defaults`
        );
        saveSession(ensured);
        setSession(ensured);
        setActiveGroupId(ensured.defaultGroupId);
        setStatus("idle");
        void refreshAgents(ensured);
        return;
      } catch {
        // fall through
      }
    }

    const created = await api<WorkspaceDefaults>(`/api/workspaces`, {
      method: "POST",
      body: JSON.stringify({ name: "Default Workspace" }),
    });
    saveSession(created);
    setSession(created);
    setActiveGroupId(created.defaultGroupId);
    setStatus("idle");
    void refreshAgents(created);
  }, [refreshAgents]);

  const createWorkspace = useCallback(async (name?: string) => {
    setError(null);
    setAgentError(null);
    setStatus("boot");
    const created = await api<WorkspaceDefaults>(`/api/workspaces`, {
      method: "POST",
      body: JSON.stringify({ name: name?.trim() || "New Workspace" }),
    });
    saveSession(created);
    setSession(created);
    setActiveGroupId(created.defaultGroupId);
    setStatus("idle");
    window.history.replaceState(null, "", "/im");
    void refreshAgents(created);
    return created;
  }, [refreshAgents]);

  const refreshGroups = useCallback(async (s: WorkspaceDefaults) => {
    setStatus("groups");
    const q = new URLSearchParams({ workspaceId: s.workspaceId, agentId: s.humanAgentId });
    const { groups } = await api<{ groups: Group[] }>(`/api/groups?${q.toString()}`);
    setGroups(groups);
    setStatus("idle");
  }, []);

  const refreshMessages = useCallback(
    async (s: WorkspaceDefaults, groupId: string, opts?: { markRead?: boolean }) => {
      setStatus("messages");
      const q = new URLSearchParams();
      if (opts?.markRead ?? true) q.set("markRead", "true");
      q.set("readerId", s.humanAgentId);
      const suffix = q.size ? `?${q.toString()}` : "";
      const { messages } = await api<{ messages: Message[] }>(
        `/api/groups/${groupId}/messages${suffix}`
      );
      setMessages(messages);
      setStatus("idle");
      void refreshGroups(s);
      queueMicrotask(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
    },
    [refreshGroups]
  );

  const connectAgentStream = useCallback(
    (agentId: string) => {
      if (streamAgentIdRef.current === agentId && esRef.current) return;
      streamAgentIdRef.current = agentId;

      esRef.current?.close();
      setLlmHistory("");
      setContentStream("");
      setReasoningStream("");
      setToolStream("");
      setAgentError(null);
      toolCallBuffersRef.current = new Map();
      toolResultBuffersRef.current = new Map();

      const groupId = activeGroupIdRef.current;
      const suffix = groupId ? `?groupId=${encodeURIComponent(groupId)}` : "";
      const es = new EventSource(`/api/agents/${agentId}/context-stream${suffix}`);
      esRef.current = es;

      es.onmessage = (evt) => {
        try {
          const payload = JSON.parse(evt.data) as AgentStreamEvent;
          if (payload.event === "agent.stream") {
            const chunk = payload.data.delta;
            if (chunk) {
              if (payload.data.kind === "content") {
                setContentStream((t) => t + chunk);
              } else if (payload.data.kind === "reasoning") {
                setReasoningStream((t) => t + chunk);
              } else {
                const name = payload.data.tool_call_name ?? payload.data.tool_call_id ?? "tool_call";
                const key = payload.data.tool_call_id ?? name;
                const buffers =
                  payload.data.kind === "tool_result"
                    ? toolResultBuffersRef.current
                    : toolCallBuffersRef.current;
                const next = `${buffers.get(key) ?? ""}${chunk}`;
                buffers.set(key, next);
                const callLines = Array.from(toolCallBuffersRef.current.entries()).map(
                  ([id, value]) => `tool_calls[${id}]: ${value}`
                );
                const resultLines = Array.from(toolResultBuffersRef.current.entries()).map(
                  ([id, value]) => `tool_result[${id}]: ${value}`
                );
                setToolStream([...callLines, ...resultLines].join("\n\n"));
              }
            }
            return;
          }
          if (payload.event === "agent.wakeup") {
            setContentStream("");
            setReasoningStream("");
            setToolStream("");
            toolCallBuffersRef.current = new Map();
            toolResultBuffersRef.current = new Map();
            return;
          }
          if (payload.event === "agent.unread") {
            setContentStream("");
            setReasoningStream("");
            setToolStream("");
            toolCallBuffersRef.current = new Map();
            toolResultBuffersRef.current = new Map();
            return;
          }
          if (payload.event === "agent.done") {
            toolCallBuffersRef.current = new Map();
            toolResultBuffersRef.current = new Map();
            const groupId = activeGroupIdRef.current;
            const nextSession = loadSession();
            if (nextSession && groupId) void refreshMessages(nextSession, groupId, { markRead: false });
            if (nextSession) void refreshGroups(nextSession);
            const agentId = streamAgentIdRef.current;
            if (agentId) void refreshLlmHistory(agentId);
            return;
          }
          if (payload.event === "agent.error") {
            setAgentError(payload.data.message);
          }
        } catch {
          // ignore
        }
      };

      es.onerror = () => setAgentError("SSE disconnected");
    },
    [refreshGroups, refreshMessages]
  );

  const hireSubAgent = useCallback(async () => {
    if (!session) return;
    const role = (window.prompt("Sub-agent role", "assistant") ?? "").trim();
    if (!role) return;

    setError(null);
    setAgentError(null);
    setStatus("boot");

    try {
      const created = await api<{ agentId: string; groupId: string }>(`/api/agents`, {
        method: "POST",
        body: JSON.stringify({
          workspaceId: session.workspaceId,
          creatorId: session.humanAgentId,
          role,
        }),
      });

      setStatus("idle");
      void refreshGroups(session);
      void refreshAgents(session);
      setActiveGroupId(created.groupId);
      connectAgentStream(created.agentId);
    } catch (e) {
      setStatus("idle");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [connectAgentStream, refreshGroups, session]);

  const toggleGroupMember = useCallback((id: UUID) => {
    setSelectedGroupMemberIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const createGroupFromSelection = useCallback(async () => {
    if (!session) return;
    if (selectedGroupMemberIds.length === 0) return;

    setError(null);
    setAgentError(null);
    setStatus("boot");

    try {
      const memberIds = Array.from(
        new Set([session.humanAgentId, ...selectedGroupMemberIds].filter(Boolean))
      );
      if (memberIds.length < 2) {
        setStatus("idle");
        setError("Need at least 2 members");
        return;
      }

      const nameRaw = window.prompt("Group name (optional)", "") ?? "";
      const name = nameRaw.trim() || undefined;

      const created = await api<{ id: string; name: string | null }>(`/api/groups`, {
        method: "POST",
        body: JSON.stringify({ workspaceId: session.workspaceId, memberIds, name }),
      });

      setSelectedGroupMemberIds([]);
      setSelectedToAgentId(null);
      setSearchQuery("");
      setActiveGroupId(created.id);

      const firstNonHuman =
        memberIds.find((id) => id !== session.humanAgentId) ?? session.assistantAgentId;
      connectAgentStream(firstNonHuman);
      setStatus("idle");
      void refreshGroups(session);
      void refreshAgents(session);
    } catch (e) {
      setStatus("idle");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [
    connectAgentStream,
    refreshAgents,
    refreshGroups,
    selectedGroupMemberIds,
    session,
  ]);

  const onSend = useCallback(async () => {
    if (!session || !activeGroupId) return;
    const text = draft.trim();
    if (!text) return;

    if (text.startsWith("/create") || text.startsWith("/hire")) {
      const role = text.replace(/^\/(create|hire)\s*/i, "").trim();
      if (!role) {
        setError("Usage: /create <role>");
        return;
      }

      setStatus("boot");
      setError(null);

      try {
        const created = await api<{ agentId: string; groupId: string }>(`/api/agents`, {
          method: "POST",
          body: JSON.stringify({
            workspaceId: session.workspaceId,
            creatorId: session.humanAgentId,
            role,
          }),
        });
        setDraft("");
        setStatus("idle");
        void refreshGroups(session);
        void refreshAgents(session);
        setActiveGroupId(created.groupId);
        connectAgentStream(created.agentId);
        return;
      } catch (e) {
        setStatus("idle");
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }

    setStatus("send");
    setError(null);

    const optimistic: Message = {
      id: `optimistic-${Date.now()}`,
      senderId: session.humanAgentId,
      content: text,
      contentType: "text",
      sendTime: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    setDraft("");
    queueMicrotask(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));

    try {
      const targetId = selectedToAgentId;
      const activeHasTarget =
        !!targetId &&
        !!activeGroup?.memberIds?.includes(targetId) &&
        !!activeGroup?.memberIds?.includes(session.humanAgentId);

      if (targetId && !activeHasTarget) {
        const candidates = groups
          .filter(
            (g) =>
              g.memberIds.includes(session.humanAgentId) &&
              g.memberIds.includes(targetId) &&
              g.memberIds.length === 2
          )
          .sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));

        const opened =
          candidates[0] ??
          (await api<{ id: string; name: string | null }>(`/api/groups`, {
            method: "POST",
            body: JSON.stringify({
              workspaceId: session.workspaceId,
              memberIds: [session.humanAgentId, targetId],
              name: null,
            }),
          }));

        await api(`/api/groups/${opened.id}/messages`, {
          method: "POST",
          body: JSON.stringify({ senderId: session.humanAgentId, content: text, contentType: "text" }),
        });
        setStatus("idle");
        setSelectedToAgentId(null);
        setSearchQuery("");
        setActiveGroupId(opened.id);
        connectAgentStream(targetId);
        void refreshGroups(session);
        return;
      }

      await api(`/api/groups/${activeGroupId}/messages`, {
        method: "POST",
        body: JSON.stringify({ senderId: session.humanAgentId, content: text, contentType: "text" }),
      });
      setSelectedToAgentId(null);
      setSearchQuery("");
    } finally {
      // keep going
    }

    setStatus("idle");
    void refreshMessages(session, activeGroupId, { markRead: false });
    void refreshGroups(session);
  }, [
    activeGroup,
    activeGroupId,
    connectAgentStream,
    draft,
    refreshAgents,
    refreshGroups,
    refreshMessages,
    selectedToAgentId,
    groups,
    session,
  ]);

  useEffect(() => {
    void bootstrap(workspaceOverrideId).catch((e) =>
      setError(e instanceof Error ? e.message : String(e))
    );
  }, [bootstrap, workspaceOverrideId]);

  useEffect(() => {
    activeGroupIdRef.current = activeGroupId;
  }, [activeGroupId]);

  useEffect(() => {
    if (!session) return;
    void refreshGroups(session).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    void refreshAgents(session).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [refreshGroups, session]);

  useEffect(() => {
    if (!session || !searchOpen) return;
    const q = searchQuery.trim();
    void (async () => {
      try {
        const params = new URLSearchParams({
          workspaceId: session.workspaceId,
          agentId: session.humanAgentId,
          q,
        });
        const res = await api<{ agents: AgentMeta[]; groups: Group[] }>(
          `/api/search?${params.toString()}`
        );
        setSearchResults({ agents: res.agents, groups: res.groups });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setSearchResults({ agents: [], groups: [] });
      }
    })();
  }, [searchOpen, searchQuery, session]);

  useEffect(() => {
    if (!session) return;
    uiEsRef.current?.close();
    const es = new EventSource(`/api/ui-stream?workspaceId=${encodeURIComponent(session.workspaceId)}`);
    uiEsRef.current = es;

    es.onmessage = () => {
      // any change in workspace => refresh lists (cheap enough for MVP)
      void refreshGroups(session);
      void refreshAgents(session);
      if (streamAgentId) void refreshLlmHistory(streamAgentId);
      if (activeGroupIdRef.current) {
        void refreshMessages(session, activeGroupIdRef.current, { markRead: false });
      }
    };
    es.onerror = () => {
      // tolerate disconnects; user can refresh manually
    };

    return () => es.close();
  }, [refreshAgents, refreshGroups, refreshLlmHistory, session, streamAgentId]);

  useEffect(() => {
    if (!streamAgentId) return;
    connectAgentStream(streamAgentId);
    setLlmHistory("");
    void refreshLlmHistory(streamAgentId);
  }, [connectAgentStream, refreshLlmHistory, streamAgentId]);

  useEffect(() => {
    if (!activeGroupId || !session) return;
    void refreshMessages(session, activeGroupId, { markRead: true }).catch((e) =>
      setError(e instanceof Error ? e.message : String(e))
    );
  }, [activeGroupId, refreshMessages, session]);

  useEffect(() => {
    return () => esRef.current?.close();
  }, []);

  const title = getGroupLabel(activeGroup);

  return (
    <div className="app">
      <aside className="panel panel-left">
        <div className="header">
          <div>
            <div style={{ fontWeight: 700 }}>Workspace</div>
            <div className="muted mono" style={{ fontSize: 12 }}>
              {session?.workspaceId ?? "-"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn"
              onClick={() => session && void refreshGroups(session)}
              disabled={!session || status === "groups"}
            >
              Refresh
            </button>
            <button
              className="btn"
              onClick={() => void hireSubAgent()}
              disabled={!session || (status !== "idle" && status !== "boot")}
              title="Create a sub-agent and open a new P2P chat"
            >
              Hire
            </button>
            <button
              className="btn"
              onClick={() => {
                const name = window.prompt("Workspace name", "New Workspace") ?? "";
                if (name === "") return;
                void createWorkspace(name);
              }}
              disabled={status !== "idle" && status !== "boot"}
              title="Create a new workspace"
            >
              New
            </button>
          </div>
        </div>

        <div style={{ padding: 12 }}>
          <div style={{ position: "relative" }}>
            <input
              className="input"
              placeholder="Search agents…"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => {
                setSearchOpen(true);
                if (session) void refreshAgents(session);
              }}
              onBlur={() => {
                // allow click selection
                window.setTimeout(() => {
                  setSearchOpen(false);
                  if (session && selectedGroupMemberIds.length > 1) {
                    const confirmed = window.confirm("Create a new group with the selected agents?");
                    if (confirmed) void createGroupFromSelection();
                  }
                }, 120);
              }}
            />
            {searchOpen ? (
              <div
                className="card"
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  left: 0,
                  right: 0,
                  zIndex: 50,
                  maxHeight: 320,
                  overflow: "auto",
                }}
              >
                <div className="card-title">Agents</div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {searchAgents.length === 0 ? (
                    <div className="muted" style={{ padding: 12 }}>
                      No matches.
                    </div>
                  ) : (
	                    searchAgents.slice(0, 50).map((a) => (
	                      <button
	                        key={a.id}
	                        className={cx("row", selectedToAgentId === a.id && "active")}
	                        onMouseDown={(e) => e.preventDefault()}
	                        onClick={() => {
	                          if (!session) return;
	                          setSelectedToAgentId(a.id);
	                          setSelectedGroupMemberIds((prev) =>
	                            prev.includes(a.id) ? prev : [...prev, a.id]
	                          );
	                          setSearchOpen(false);

	                          // If there is an existing conversation thread between human and this agent,
	                          // switch to the most recently updated one. Otherwise, only "arm" the target:
	                          // the first sent message will create a new conversation.
	                          const candidates = groups
	                            .filter(
	                              (g) =>
	                                g.memberIds.includes(session.humanAgentId) &&
	                                g.memberIds.includes(a.id)
	                            )
	                            .sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));

	                          if (candidates[0]) {
	                            setActiveGroupId(candidates[0].id);
	                            connectAgentStream(a.id);
	                            return;
	                          }

	                          if (openingConversationRef.current === a.id) return;
	                          openingConversationRef.current = a.id;

	                          void (async () => {
	                            try {
	                              const opened = await api<{ id: string; name: string | null }>(`/api/groups`, {
	                                method: "POST",
	                                body: JSON.stringify({
	                                  workspaceId: session.workspaceId,
	                                  memberIds: [session.humanAgentId, a.id],
	                                  name: null,
	                                }),
	                              });

	                              setActiveGroupId(opened.id);
	                              connectAgentStream(a.id);
	                              void refreshGroups(session);
	                            } catch (e) {
	                              setError(e instanceof Error ? e.message : String(e));
	                            } finally {
	                              openingConversationRef.current = null;
	                            }
	                          })();
	                        }}
	                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                            <input
                              type="checkbox"
                              checked={selectedGroupMemberIds.includes(a.id)}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleGroupMember(a.id);
                              }}
                              readOnly
                            />
                            <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
                              {a.role}
                            </div>
                          </div>
                          <div className="muted mono" style={{ fontSize: 12 }}>
                            {a.id.slice(0, 8)}
                          </div>
                        </div>
                        <div className="muted mono" style={{ fontSize: 12, marginTop: 6 }}>
                          {a.id}
                        </div>
	                      </button>
                    ))
                  )}
                </div>

                <div className="card-title" style={{ marginTop: 12 }}>
                  Groups
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {searchGroups.length === 0 ? (
                    <div className="muted" style={{ padding: 12 }}>
                      No matches.
                    </div>
                  ) : (
                    searchGroups.slice(0, 50).map((g) => (
                      <button
                        key={g.id}
                        className={cx("row", g.id === activeGroupId && "active")}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (!session) return;
                          setActiveGroupId(g.id);
                          const nextAgentId =
                            g.memberIds.find((id) => id !== session.humanAgentId) ??
                            session.assistantAgentId;
                          connectAgentStream(nextAgentId);
                          setSearchOpen(false);
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                          <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {getGroupLabel(g)}
                          </div>
                          {g.unreadCount > 0 && <span className="badge">{g.unreadCount}</span>}
                        </div>
                        <div className="muted mono" style={{ fontSize: 12, marginTop: 6 }}>
                          {g.id.slice(0, 8)}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>
          <div className="muted mono" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.4 }}>
            human: {session?.humanAgentId ?? "-"}
            <br />
            assistant: {session?.assistantAgentId ?? "-"}
            {selectedToAgentId ? (
              <>
                <br />
                to: {selectedToAgentId}
              </>
            ) : null}
          </div>
        </div>

        <div className="list">
          {groups.length === 0 ? (
            <div style={{ padding: 16 }} className="muted">
              No groups yet.
            </div>
          ) : (
            groups.map((g) => (
              <button
                key={g.id}
                className={cx("row", g.id === activeGroupId && "active")}
                onClick={() => {
                  setActiveGroupId(g.id);
                  setSelectedToAgentId(null);
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
	                  <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
	                    {getGroupLabel(g)}
	                  </div>
                  {g.unreadCount > 0 && <span className="badge">{g.unreadCount}</span>}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {g.lastMessage ? g.lastMessage.content : "—"}
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      <main className="panel panel-mid">
        <div className="header">
          <div style={{ fontWeight: 700 }}>{title}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {status !== "idle" ? `${status}...` : ""}
          </div>
        </div>

        <div className="chat">
          {messages.map((m) => {
            const isMe = m.senderId === session?.humanAgentId;
            return (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  justifyContent: isMe ? "flex-end" : "flex-start",
                  marginBottom: 10,
                }}
              >
                <div className={cx("bubble", isMe ? "me" : "other")}>
                  <div className="bubble-meta">
                    {fmtTime(m.sendTime)} • {isMe ? "You" : m.senderId.slice(0, 8)}
                  </div>
                  <div>{m.content}</div>
                </div>
              </div>
            );
          })}

          <div ref={bottomRef} />
        </div>

        {error ? <div className="toast">{error}</div> : null}

        <div className="composer">
          <textarea
            className="input textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type a message… (Ctrl/Cmd+Enter to send)"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void onSend();
              }
            }}
          />
          <button className="btn btn-primary" onClick={() => void onSend()} disabled={!draft.trim() || status === "send"}>
            Send
          </button>
        </div>
      </main>

      <section className="panel panel-right">
        <div className="header">
          <div style={{ fontWeight: 700 }}>Agent Details</div>
          <button
            className="btn"
            onClick={() => {
              setLlmHistory("");
              setContentStream("");
              setReasoningStream("");
              setToolStream("");
              setAgentError(null);
            }}
          >
            Clear
          </button>
        </div>

        <div style={{ padding: 16, overflow: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            Streaming from: <span className="mono">{streamAgentId ?? "-"}</span>
          </div>
          {agentError ? <div className="toast" style={{ borderColor: "#713f12", background: "rgba(113,63,18,0.25)", color: "#fde68a" }}>{agentError}</div> : null}

          <div className="card">
            <div className="card-title">Realtime content</div>
            <div className="card-body mono">{contentStream || "—"}</div>
          </div>

          <div className="card">
            <div className="card-title">Realtime reasoning</div>
            <div className="card-body mono">{reasoningStream || "—"}</div>
          </div>

          <div className="card">
            <div className="card-title">Realtime tools</div>
            <div className="card-body mono">{toolStream || "—"}</div>
          </div>

          <div className="card">
            <div className="card-title">LLM history</div>
            <div className="card-body mono" style={{ whiteSpace: "pre-wrap" }}>
              {llmHistory || "—"}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
