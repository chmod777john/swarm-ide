"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type UUID = string;

type WorkspaceDefaults = {
  workspaceId: UUID;
  humanAgentId: UUID;
  assistantAgentId: UUID;
  defaultGroupId: UUID;
};

type Group = {
  id: UUID;
  name: string | null;
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
  | { event: "agent.history"; data: { history: Array<{ role: string; content: string }> } }
  | {
      id: number;
      at: number;
      event: "agent.stream";
      data: { kind: "reasoning" | "content"; delta: string };
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
  const searchParams = useSearchParams();
  const workspaceOverrideId = searchParams.get("workspaceId");
  const [session, setSession] = useState<WorkspaceDefaults | null>(() => null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"boot" | "groups" | "messages" | "send" | "idle">("boot");
  const [error, setError] = useState<string | null>(null);

  const [assistantStreamingText, setAssistantStreamingText] = useState("");
  const [assistantStreamingReasoning, setAssistantStreamingReasoning] = useState("");
  const [agentHistory, setAgentHistory] = useState<Array<{ role: string; content: string }>>([]);
  const [agentError, setAgentError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const activeGroupIdRef = useRef<string | null>(null);

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId) ?? null,
    [groups, activeGroupId]
  );

  const bootstrap = useCallback(async (overrideWorkspaceId: string | null) => {
    setError(null);
    setAgentError(null);
    setStatus("boot");

    setGroups([]);
    setMessages([]);
    setAssistantStreamingText("");
    setAssistantStreamingReasoning("");
    setAgentHistory([]);
    esRef.current?.close();

    if (overrideWorkspaceId) {
      const ensured = await api<WorkspaceDefaults>(
        `/api/workspaces/${overrideWorkspaceId}/defaults`
      );
      saveSession(ensured);
      setSession(ensured);
      setActiveGroupId(ensured.defaultGroupId);
      setStatus("idle");
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
  }, []);

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
    return created;
  }, []);

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
      esRef.current?.close();
      setAssistantStreamingText("");
      setAssistantStreamingReasoning("");
      setAgentError(null);

      const es = new EventSource(`/api/agents/${agentId}/context-stream`);
      esRef.current = es;

      es.onmessage = (evt) => {
        try {
          const payload = JSON.parse(evt.data) as AgentStreamEvent;
          if (payload.event === "agent.history") {
            setAgentHistory(payload.data.history);
            return;
          }
          if (payload.event === "agent.stream") {
            if (payload.data.kind === "content") {
              setAssistantStreamingText((t) => t + payload.data.delta);
            } else {
              setAssistantStreamingReasoning((t) => t + payload.data.delta);
            }
            return;
          }
          if (payload.event === "agent.done") {
            const groupId = activeGroupIdRef.current;
            const nextSession = loadSession();
            if (nextSession && groupId) void refreshMessages(nextSession, groupId, { markRead: false });
            if (nextSession) void refreshGroups(nextSession);
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

  const onSend = useCallback(async () => {
    if (!session || !activeGroupId) return;
    const text = draft.trim();
    if (!text) return;

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

    await api(`/api/groups/${activeGroupId}/messages`, {
      method: "POST",
      body: JSON.stringify({ senderId: session.humanAgentId, content: text, contentType: "text" }),
    });

    setStatus("idle");
    void refreshMessages(session, activeGroupId, { markRead: false });
    void refreshGroups(session);
  }, [activeGroupId, draft, refreshGroups, refreshMessages, session]);

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
    connectAgentStream(session.assistantAgentId);
  }, [connectAgentStream, refreshGroups, session]);

  useEffect(() => {
    if (!activeGroupId || !session) return;
    void refreshMessages(session, activeGroupId, { markRead: true }).catch((e) =>
      setError(e instanceof Error ? e.message : String(e))
    );
  }, [activeGroupId, refreshMessages, session]);

  useEffect(() => {
    return () => esRef.current?.close();
  }, []);

  const title =
    activeGroup?.name ??
    (activeGroupId === session?.defaultGroupId ? "P2P 人类↔助手" : "Group");

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
          <input className="input" placeholder="Search (MVP pending)" disabled />
          <div className="muted mono" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.4 }}>
            human: {session?.humanAgentId ?? "-"}
            <br />
            assistant: {session?.assistantAgentId ?? "-"}
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
                onClick={() => setActiveGroupId(g.id)}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {g.name ?? (g.id === session?.defaultGroupId ? "P2P 人类↔助手" : "Unnamed")}
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

          {assistantStreamingText ? (
            <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 10 }}>
              <div className="bubble other">
                <div className="bubble-meta">Assistant (streaming)</div>
                <div>{assistantStreamingText}</div>
              </div>
            </div>
          ) : null}

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
              setAssistantStreamingText("");
              setAssistantStreamingReasoning("");
              setAgentError(null);
            }}
          >
            Clear
          </button>
        </div>

        <div style={{ padding: 16, overflow: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            Streaming from: <span className="mono">{session?.assistantAgentId ?? "-"}</span>
          </div>
          {agentError ? <div className="toast" style={{ borderColor: "#713f12", background: "rgba(113,63,18,0.25)", color: "#fde68a" }}>{agentError}</div> : null}

          <div className="card">
            <div className="card-title">Context (agents.llm_history)</div>
            <div className="card-body mono">
              {agentHistory.length === 0
                ? "—"
                : agentHistory.map((m, i) => `${i + 1}. ${m.role}: ${m.content}`).join("\n\n")}
            </div>
          </div>

          <div className="card">
            <div className="card-title">Reasoning stream (delta)</div>
            <div className="card-body mono">{assistantStreamingReasoning || "—"}</div>
          </div>
        </div>
      </section>
    </div>
  );
}
