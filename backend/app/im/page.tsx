"use client";

import { useSearchParams } from "next/navigation";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, TouchEvent as ReactTouchEvent } from "react";
import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Briefcase, ChevronDown, ChevronLeft, ChevronRight, Code2, Network, User } from "lucide-react";
import { Streamdown } from "streamdown";
import { createCodePlugin } from "@streamdown/code";
import { mermaid } from "@streamdown/mermaid";
import { IMShell } from "./IMShell";
import { IMMessageList } from "./IMMessageList";
import { IMHistoryList } from "./IMHistoryList";

// Create code plugin with dark theme
const code = createCodePlugin({
  themes: ["github-dark", "github-dark"], // Use dark theme for both light/dark modes
});

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

type AgentStatus = "IDLE" | "BUSY" | "WAKING";

type Group = {
  id: UUID;
  name: string | null;
  memberIds: UUID[];
  unreadCount: number;
  contextTokens: number;
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

type UiStreamEvent = {
  id?: number;
  at?: number;
  event: string;
  data: Record<string, any>;
};

type VizEvent = {
  id: string;
  kind: "agent" | "message" | "llm" | "tool" | "db";
  label: string;
  at: number;
};

type VizBeam = {
  id: string;
  fromId: UUID;
  toId: UUID;
  kind: "create" | "message";
  label?: string;
  createdAt: number;
};

type VizDebugEntry = {
  id: string;
  at: number;
  type: "message_event" | "beam_created" | "beam_skipped";
  data: Record<string, unknown>;
};

type RightPanelId = "history" | "content" | "reasoning" | "tools";
type RightPanelState = {
  id: RightPanelId;
  title: string;
  size: number;
  collapsed: boolean;
};

// Streamdown plugins for markdown rendering
const streamdownPlugins = { code, mermaid };

// Helper component for rendering markdown content
function MarkdownContent({ content, className = "" }: { content: string; className?: string }) {
  if (!content) return <span className="muted">—</span>;
  return (
    <div className={className}>
      <Streamdown plugins={streamdownPlugins}>{content}</Streamdown>
    </div>
  );
}

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
const RIGHT_PANEL_MIN_HEIGHT = 120;
const RIGHT_PANEL_HEADER_HEIGHT = 32;
const MID_CHAT_MIN_HEIGHT = 0;
const MID_GRAPH_MIN_HEIGHT = 160;
const MID_SPLITTER_SIZE = 6;

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
  const [tokenLimit, setTokenLimit] = useState<number>(100000);
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
  const [vizEvents, setVizEvents] = useState<VizEvent[]>([]);
  const [vizBeams, setVizBeams] = useState<VizBeam[]>([]);
  const [vizSize, setVizSize] = useState({ width: 640, height: 260 });
  const [vizScale, setVizScale] = useState(0.9);
  const [vizOffset, setVizOffset] = useState({ x: 0, y: 0 });
  const [vizIsPanning, setVizIsPanning] = useState(false);
  const [agentStatusById, setAgentStatusById] = useState<Record<string, AgentStatus>>({});
  const [vizDebug, setVizDebug] = useState<VizDebugEntry[]>([]);
  const [vizEventsCollapsed, setVizEventsCollapsed] = useState(false);
  const [rightPanels, setRightPanels] = useState<RightPanelState[]>([
    { id: "history", title: "LLM history", size: 320, collapsed: false },
    { id: "content", title: "Realtime content", size: 220, collapsed: false },
    { id: "reasoning", title: "Realtime reasoning", size: 220, collapsed: false },
    { id: "tools", title: "Realtime tools", size: 200, collapsed: false },
  ]);
  const [midSplitRatio, setMidSplitRatio] = useState(0.55);
  const [midStackHeight, setMidStackHeight] = useState(0);
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const [collapsedAgents, setCollapsedAgents] = useState<Record<string, boolean>>({});

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const activeGroupIdRef = useRef<string | null>(null);
  const streamAgentIdRef = useRef<string | null>(null);
  const streamAgentIdValueRef = useRef<string | null>(null);
  const agentRoleByIdRef = useRef<Map<string, string>>(new Map());
  const toolCallBuffersRef = useRef<Map<string, string>>(new Map());
  const toolResultBuffersRef = useRef<Map<string, string>>(new Map());
  const uiEsRef = useRef<EventSource | null>(null);
  const llmHistoryReqIdRef = useRef(0);
  const vizRef = useRef<HTMLDivElement | null>(null);
  const midStackRef = useRef<HTMLDivElement | null>(null);
  const midChatHeightRef = useRef(0);
  const nodeOffsetsRef = useRef<Record<string, { x: number; y: number }>>({});
  const groupsRef = useRef<Group[]>([]);
  const beamTimeoutsRef = useRef<number[]>([]);
  const refreshQueueRef = useRef<{
    timer: number | null;
    pending: { groups: boolean; agents: boolean; messages: boolean; llmHistory: boolean };
  }>({ timer: null, pending: { groups: false, agents: false, messages: false, llmHistory: false } });
  const vizPanStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);


  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId) ?? null,
    [groups, activeGroupId]
  );

  const agentRoleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) map.set(a.id, a.role);
    return map;
  }, [agents]);

  const vizLayout = useMemo(() => {
    const width = Math.max(1, vizSize.width);
    const height = Math.max(1, vizSize.height);
    const paddingX = 70;
    const paddingY = 60;
    const byId = new Map(agents.map((a) => [a.id, a]));
    const parentById = new Map<string, string | null>();
    const childrenById = new Map<string, AgentMeta[]>();
    const roots: AgentMeta[] = [];

    for (const agent of agents) {
      const parentId = agent.parentId;
      if (parentId && parentId !== agent.id && byId.has(parentId)) {
        const list = childrenById.get(parentId) ?? [];
        list.push(agent);
        childrenById.set(parentId, list);
        parentById.set(agent.id, parentId);
      } else {
        roots.push(agent);
        parentById.set(agent.id, null);
      }
    }

    const byCreatedAt = (a: AgentMeta, b: AgentMeta) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

    for (const list of childrenById.values()) list.sort(byCreatedAt);
    roots.sort(byCreatedAt);

    if (session) {
      const humanIndex = roots.findIndex((a) => a.id === session.humanAgentId);
      if (humanIndex > -1) {
        const [human] = roots.splice(humanIndex, 1);
        roots.unshift(human);
      }
    }

    const nodeMeta = new Map<string, { xIndex: number; depth: number }>();
    let leafIndex = 0;
    let maxDepth = 0;
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const walk = (agent: AgentMeta, depth: number): { min: number; max: number } => {
      if (visited.has(agent.id)) {
        const meta = nodeMeta.get(agent.id);
        if (meta) return { min: meta.xIndex, max: meta.xIndex };
      }
      if (visiting.has(agent.id)) {
        const xIndex = leafIndex++;
        nodeMeta.set(agent.id, { xIndex, depth });
        return { min: xIndex, max: xIndex };
      }

      visiting.add(agent.id);
      maxDepth = Math.max(maxDepth, depth);
      const children = (childrenById.get(agent.id) ?? []).filter((child) => child.id !== agent.id);
      let range: { min: number; max: number };
      if (children.length === 0) {
        const xIndex = leafIndex++;
        nodeMeta.set(agent.id, { xIndex, depth });
        range = { min: xIndex, max: xIndex };
      } else {
        const ranges = children.map((child) => walk(child, depth + 1));
        const min = ranges[0]?.min ?? leafIndex;
        const max = ranges[ranges.length - 1]?.max ?? min;
        const xIndex = (min + max) / 2;
        nodeMeta.set(agent.id, { xIndex, depth });
        range = { min, max };
      }
      visiting.delete(agent.id);
      visited.add(agent.id);
      return range;
    };

    roots.forEach((root) => {
      walk(root, 0);
    });

    for (const agent of agents) {
      if (!nodeMeta.has(agent.id)) {
        walk(agent, 0);
      }
    }

    const leafCount = Math.max(1, leafIndex);
    const depthCount = Math.max(1, maxDepth + 1);
    const baseSpan = Math.max(1, width - paddingX * 2);
    const maxSpan =
      leafCount <= 2 ? Math.min(baseSpan, 360) : leafCount <= 4 ? Math.min(baseSpan, 520) : baseSpan;
    const xSpan = Math.max(1, maxSpan);
    const xStart = (width - xSpan) / 2;
    const ySpan = Math.max(1, height - paddingY * 2);
    const xStep = leafCount === 1 ? 0 : xSpan / (leafCount - 1);
    const yStep = depthCount === 1 ? 0 : ySpan / (depthCount - 1);

    const basePositions = new Map<string, { x: number; y: number }>();
    for (const agent of agents) {
      const meta = nodeMeta.get(agent.id);
      if (!meta) continue;
      basePositions.set(agent.id, {
        x: xStart + meta.xIndex * xStep,
        y: paddingY + meta.depth * yStep,
      });
    }

    const offsetCache = new Map<string, { x: number; y: number }>();
    const positions = new Map<string, { x: number; y: number }>();
    const getAccumulatedOffset = (id: string) => {
      if (offsetCache.has(id)) return offsetCache.get(id)!;
      let x = 0;
      let y = 0;
      const seen = new Set<string>();
      let current: string | null | undefined = id;
      while (current) {
        if (seen.has(current)) break;
        seen.add(current);
        const offset = nodeOffsets[current];
        if (offset) {
          x += offset.x;
          y += offset.y;
        }
        current = parentById.get(current) ?? null;
      }
      const total = { x, y };
      offsetCache.set(id, total);
      return total;
    };

    for (const agent of agents) {
      const base = basePositions.get(agent.id);
      if (!base) continue;
      const offset = getAccumulatedOffset(agent.id);
      positions.set(agent.id, { x: base.x + offset.x, y: base.y + offset.y });
    }

    const ordered = [...agents].sort((a, b) => {
      const da = nodeMeta.get(a.id)?.depth ?? 0;
      const db = nodeMeta.get(b.id)?.depth ?? 0;
      if (da !== db) return da - db;
      return byCreatedAt(a, b);
    });

    const edges: Array<{ fromId: UUID; toId: UUID }> = [];
    for (const [parentId, children] of childrenById.entries()) {
      for (const child of children) {
        edges.push({ fromId: parentId, toId: child.id });
      }
    }

    return { positions, ordered, edges, parentById };
  }, [agents, session, vizSize.height, vizSize.width, nodeOffsets]);

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

  const groupByAgentId = useMemo(() => {
    const map = new Map<string, Group>();
    if (!session) return map;
    for (const g of groups) {
      if (!g.memberIds.includes(session.humanAgentId)) continue;
      const others = g.memberIds.filter((id) => id !== session.humanAgentId);
      if (others.length === 1) {
        map.set(others[0], g);
      }
    }
    return map;
  }, [groups, session]);

  const agentTreeRows = useMemo(() => {
    if (!session)
      return [] as Array<{
        agent: AgentMeta;
        group: Group | null;
        depth: number;
        hasChildren: boolean;
        collapsed: boolean;
        guides: boolean[];
        isLast: boolean;
      }>;
    const byId = new Map(agents.map((a) => [a.id, a]));
    const childrenById = new Map<string, AgentMeta[]>();
    const roots: AgentMeta[] = [];
    const byCreatedAt = (a: AgentMeta, b: AgentMeta) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

    for (const agent of agents) {
      if (agent.role === "human") continue;
      const parentId = agent.parentId;
      const parent = parentId && parentId !== agent.id ? byId.get(parentId) : null;
      if (parent && parent.role !== "human" && parent.id !== agent.id) {
        const list = childrenById.get(parent.id) ?? [];
        list.push(agent);
        childrenById.set(parent.id, list);
      } else {
        roots.push(agent);
      }
    }

    for (const list of childrenById.values()) list.sort(byCreatedAt);
    roots.sort(byCreatedAt);

    const rows: Array<{
      agent: AgentMeta;
      group: Group | null;
      depth: number;
      hasChildren: boolean;
      collapsed: boolean;
      guides: boolean[];
      isLast: boolean;
    }> = [];
    const walk = (agent: AgentMeta, depth: number, guides: boolean[], isLast: boolean) => {
      const children = childrenById.get(agent.id) ?? [];
      const collapsed = !!collapsedAgents[agent.id];
      rows.push({
        agent,
        group: groupByAgentId.get(agent.id) ?? null,
        depth,
        hasChildren: children.length > 0,
        collapsed,
        guides,
        isLast,
      });
      if (collapsed) return;
      const nextGuides = [...guides, !isLast];
      children.forEach((child, index) => {
        walk(child, depth + 1, nextGuides, index === children.length - 1);
      });
    };
    roots.forEach((root, index) => walk(root, 0, [], index === roots.length - 1));
    return rows;
  }, [agents, collapsedAgents, groupByAgentId, session]);

  const extraGroups = useMemo(() => {
    if (!session) return groups;
    const mappedIds = new Set(Array.from(groupByAgentId.values()).map((g) => g.id));
    return groups.filter((g) => !mappedIds.has(g.id));
  }, [groupByAgentId, groups, session]);

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
        setLlmHistory(res.llmHistory ?? "");
      } catch (e) {
        if (reqId !== llmHistoryReqIdRef.current) return;
        setLlmHistory(
          e instanceof Error ? `(failed to load llm_history: ${e.message})` : "(failed to load llm_history)"
        );
      }
    },
    [formatLlmHistory]
  );

  const llmHistoryParsed = useMemo(() => {
    if (!llmHistory) return null;
    try {
      return JSON.parse(llmHistory);
    } catch {
      return null;
    }
  }, [llmHistory]);

  const llmHistoryFormatted = useMemo(() => {
    if (!llmHistory) return "";
    return formatLlmHistory(llmHistory);
  }, [formatLlmHistory, llmHistory]);

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

    try {
      const recent = await api<{
        workspaces: Array<{ id: string; name: string; createdAt: string }>;
      }>(`/api/workspaces`);
      if (recent.workspaces.length > 0) {
        const targetId = recent.workspaces[0]!.id;
        const ensured = await api<WorkspaceDefaults>(
          `/api/workspaces/${targetId}/defaults`
        );
        saveSession(ensured);
        setSession(ensured);
        setActiveGroupId(ensured.defaultGroupId);
        setStatus("idle");
        void refreshAgents(ensured);
        return;
      }
    } catch {
      // fall through
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

  // Load token limit config on mount
  useEffect(() => {
    api<{ tokenLimit: number }>("/api/config")
      .then((c) => setTokenLimit(c.tokenLimit))
      .catch(() => setTokenLimit(100000));
  }, []);

  const refreshGroups = useCallback(async (s: WorkspaceDefaults, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setStatus("groups");
    const q = new URLSearchParams({ workspaceId: s.workspaceId, agentId: s.humanAgentId });
    const { groups } = await api<{ groups: Group[] }>(`/api/groups?${q.toString()}`);
    setGroups(groups);
    if (!opts?.silent) setStatus("idle");
  }, []);

  const refreshMessages = useCallback(
    async (
      s: WorkspaceDefaults,
      groupId: string,
      opts?: { markRead?: boolean; silent?: boolean; skipGroupRefresh?: boolean }
    ) => {
      if (!opts?.silent) setStatus("messages");
      const q = new URLSearchParams();
      if (opts?.markRead ?? true) q.set("markRead", "true");
      q.set("readerId", s.humanAgentId);
      const suffix = q.size ? `?${q.toString()}` : "";
      const { messages } = await api<{ messages: Message[] }>(
        `/api/groups/${groupId}/messages${suffix}`
      );
      setMessages(messages);
      if (!opts?.silent) setStatus("idle");
      if (!opts?.skipGroupRefresh) {
        void refreshGroups(s, { silent: opts?.silent });
      }
      queueMicrotask(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
    },
    [refreshGroups]
  );

  const pushVizEvent = useCallback(
    (event: UiStreamEvent, label: string, kind: VizEvent["kind"]) => {
      const at = typeof event.at === "number" ? event.at : Date.now();
      const id = `${event.id ?? at}-${Math.random().toString(16).slice(2)}`;
      setVizEvents((prev) => [...prev, { id, kind, label, at }].slice(-20));
    },
    []
  );

  const pushBeam = useCallback((beam: Omit<VizBeam, "id" | "createdAt">) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const createdAt = Date.now();
    setVizBeams((prev) => [...prev, { ...beam, id, createdAt }].slice(-12));
    const timeoutId = window.setTimeout(() => {
      setVizBeams((prev) => prev.filter((b) => b.id !== id));
    }, 2400);
    beamTimeoutsRef.current.push(timeoutId);
  }, []);

  const logVizDebug = useCallback((entry: Omit<VizDebugEntry, "id" | "at">) => {
    const record: VizDebugEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      at: Date.now(),
    };
    setVizDebug((prev) => [...prev, record].slice(-200));
    if (typeof window !== "undefined") {
      (window as any).__imVizDebug = (window as any).__imVizDebug ?? [];
      (window as any).__imVizDebug.push(record);
      // eslint-disable-next-line no-console
      console.debug("[im-viz]", record);
    }
  }, []);

  const scheduleWorkspaceRefresh = useCallback(
    (opts?: { groups?: boolean; agents?: boolean; messages?: boolean; llmHistory?: boolean }) => {
      if (!session) return;
      const pending = refreshQueueRef.current.pending;
      pending.groups = opts?.groups ?? true;
      pending.agents = opts?.agents ?? true;
      pending.messages = opts?.messages ?? true;
      pending.llmHistory = opts?.llmHistory ?? true;

      if (refreshQueueRef.current.timer !== null) return;
      refreshQueueRef.current.timer = window.setTimeout(() => {
        const next = refreshQueueRef.current.pending;
        refreshQueueRef.current.pending = {
          groups: false,
          agents: false,
          messages: false,
          llmHistory: false,
        };
        refreshQueueRef.current.timer = null;

        if (next.groups) void refreshGroups(session, { silent: true });
        if (next.agents) void refreshAgents(session);
        if (next.llmHistory && streamAgentIdValueRef.current) {
          void refreshLlmHistory(streamAgentIdValueRef.current);
        }
        if (next.messages && activeGroupIdRef.current) {
          void refreshMessages(session, activeGroupIdRef.current, {
            markRead: false,
            silent: true,
            skipGroupRefresh: true,
          });
        }
      }, 200);
    },
    [refreshAgents, refreshGroups, refreshLlmHistory, refreshMessages, session]
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
      await api(`/api/groups/${activeGroupId}/messages`, {
        method: "POST",
        body: JSON.stringify({ senderId: session.humanAgentId, content: text, contentType: "text" }),
      });
    } finally {
      // keep going
    }

    setStatus("idle");
    void refreshMessages(session, activeGroupId, { markRead: false });
    void refreshGroups(session);
  }, [
    activeGroupId,
    connectAgentStream,
    draft,
    refreshAgents,
    refreshGroups,
    refreshMessages,
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
    streamAgentIdValueRef.current = streamAgentId;
  }, [streamAgentId]);

  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  useEffect(() => {
    agentRoleByIdRef.current = agentRoleById;
  }, [agentRoleById]);

  useEffect(() => {
    nodeOffsetsRef.current = nodeOffsets;
  }, [nodeOffsets]);

  useEffect(() => {
    const el = vizRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const rect = entry.contentRect;
        if (!rect.width || !rect.height) continue;
        setVizSize({ width: rect.width, height: rect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = midStackRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const rect = entry.contentRect;
        if (!rect.height) continue;
        setMidStackHeight(rect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = vizRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      setVizScale((s) => Math.min(Math.max(s + delta, 0.5), 2));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (!session) return;
    void refreshGroups(session).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    void refreshAgents(session).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [refreshGroups, session]);

  useEffect(() => {
    if (!session) return;
    uiEsRef.current?.close();
    const es = new EventSource(`/api/ui-stream?workspaceId=${encodeURIComponent(session.workspaceId)}`);
    uiEsRef.current = es;

    es.onmessage = (evt) => {
      let payload: UiStreamEvent | null = null;
      try {
        payload = JSON.parse(evt.data) as UiStreamEvent;
      } catch {
        payload = null;
      }
      if (payload) {
        if (payload.event === "ui.agent.created") {
          const role = payload.data?.agent?.role ?? "agent";
          const agentId = payload.data?.agent?.id as UUID | undefined;
          const parentId = payload.data?.agent?.parentId as UUID | null | undefined;
          pushVizEvent(payload, `创建 ${role}`, "agent");
          if (agentId) {
            const fromId = parentId || session.humanAgentId;
            pushBeam({ fromId, toId: agentId, kind: "create", label: role });
          }
          if (agentId) {
            setAgentStatusById((prev) => ({ ...prev, [agentId]: "IDLE" }));
          }
        } else if (payload.event === "ui.message.created") {
          const senderId = payload.data?.message?.senderId as UUID | undefined;
          const groupId = payload.data?.groupId as UUID | undefined;
          const senderRole = senderId
            ? agentRoleByIdRef.current.get(senderId) ?? senderId.slice(0, 6)
            : "unknown";
          pushVizEvent(payload, `消息: ${senderRole}`, "message");
          logVizDebug({
            type: "message_event",
            data: {
              messageId: payload.data?.message?.id,
              groupId,
              senderId,
              senderRole,
              hasGroup: !!groupsRef.current.find((g) => g.id === groupId),
            },
          });
          if (senderId && groupId) {
            const payloadMembers = Array.isArray(payload.data?.memberIds) ? payload.data.memberIds : null;
            const groupMembers =
              payloadMembers ??
              groupsRef.current.find((g) => g.id === groupId)?.memberIds ??
              [];
            const targetIds = groupMembers.filter((id: UUID) => id !== senderId);
            if (targetIds.length === 0) {
              logVizDebug({
                type: "beam_skipped",
                data: { reason: "no_targets", groupId, senderId },
              });
            } else {
              targetIds.forEach((targetId) => {
                pushBeam({ fromId: senderId, toId: targetId, kind: "message" });
                logVizDebug({
                  type: "beam_created",
                  data: { groupId, senderId, targetId },
                });
              });
            }
          }
        } else if (payload.event === "ui.agent.llm.start" || payload.event === "ui.agent.llm.done") {
          const agentId = payload.data?.agentId as UUID | undefined;
          const role = agentId
            ? agentRoleByIdRef.current.get(agentId) ?? agentId.slice(0, 6)
            : "agent";
          const label = payload.event === "ui.agent.llm.start" ? `LLM 开始: ${role}` : `LLM 结束: ${role}`;
          pushVizEvent(payload, label, "llm");
          if (agentId) {
            setAgentStatusById((prev) => ({
              ...prev,
              [agentId]: payload.event === "ui.agent.llm.start" ? "BUSY" : "IDLE",
            }));
          }
        } else if (
          payload.event === "ui.agent.tool_call.start" ||
          payload.event === "ui.agent.tool_call.done"
        ) {
          const agentId = payload.data?.agentId as UUID | undefined;
          const toolName = payload.data?.toolName ?? "tool";
          const role = agentId
            ? agentRoleByIdRef.current.get(agentId) ?? agentId.slice(0, 6)
            : "agent";
          const label =
            payload.event === "ui.agent.tool_call.start"
              ? `工具开始: ${role} · ${toolName}`
              : `工具结束: ${role} · ${toolName}`;
          pushVizEvent(payload, label, "tool");
          if (agentId) {
            setAgentStatusById((prev) => ({
              ...prev,
              [agentId]: payload.event === "ui.agent.tool_call.start" ? "BUSY" : "IDLE",
            }));
          }
        } else if (payload.event === "ui.db.write") {
          const table = payload.data?.table ?? "db";
          const action = payload.data?.action ?? "write";
          pushVizEvent(payload, `DB ${action}: ${table}`, "db");
        }
      }

      // any change in workspace => refresh lists (cheap enough for MVP)
      scheduleWorkspaceRefresh();
    };
    es.onerror = () => {
      // tolerate disconnects; user can refresh manually
    };

    return () => es.close();
  }, [
    logVizDebug,
    pushBeam,
    pushVizEvent,
    scheduleWorkspaceRefresh,
    session,
  ]);

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

  useEffect(() => {
    return () => {
      beamTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
      beamTimeoutsRef.current = [];
    };
  }, []);

  const roleColor = (role?: string) => {
    if (!role) return "#e4e4e7";
    if (role === "human") return "#f8fafc";
    if (role === "assistant") return "#38bdf8";
    if (role === "productmanager") return "#fb7185";
    if (role === "coder") return "#34d399";
    return "#fbbf24";
  };

  const statusColor = (status?: AgentStatus) => {
    if (status === "BUSY") return "#ef4444";
    if (status === "WAKING") return "#facc15";
    return "#22c55e";
  };

  const midChatHeight = useMemo(() => {
    if (!midStackHeight) return 0;
    const available = Math.max(0, midStackHeight - MID_SPLITTER_SIZE);
    if (available <= 0) return 0;
    const minChat = MID_CHAT_MIN_HEIGHT;
    const minGraph = MID_GRAPH_MIN_HEIGHT;
    if (available <= minGraph + minChat) {
      return Math.max(minChat, available - minGraph);
    }
    const maxChat = available - minGraph;
    const desired = available * midSplitRatio;
    return Math.min(maxChat, Math.max(minChat, desired));
  }, [midSplitRatio, midStackHeight]);

  useEffect(() => {
    midChatHeightRef.current = midChatHeight;
  }, [midChatHeight]);

  const toggleRightPanel = useCallback((id: RightPanelId) => {
    setRightPanels((prev) =>
      prev.map((panel) =>
        panel.id === id ? { ...panel, collapsed: !panel.collapsed } : panel
      )
    );
  }, []);

  const startMidResize = useCallback(
    (clientY: number) => {
      const container = midStackRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const available = Math.max(0, rect.height - MID_SPLITTER_SIZE);
      if (available <= 0) return;
      const minChat = MID_CHAT_MIN_HEIGHT;
      const minGraph = MID_GRAPH_MIN_HEIGHT;
      const maxChat = Math.max(minChat, available - minGraph);
      const startY = clientY;
      const startHeight = midChatHeightRef.current || available * midSplitRatio;

      const onMove = (e: PointerEvent | MouseEvent) => {
        const delta = e.clientY - startY;
        const next = Math.min(maxChat, Math.max(minChat, startHeight + delta));
        const ratio = available ? next / available : 0.5;
        setMidSplitRatio(ratio);
      };

      const onTouchMove = (e: TouchEvent) => {
        const touch = e.touches[0];
        if (!touch) return;
        const delta = touch.clientY - startY;
        const next = Math.min(maxChat, Math.max(minChat, startHeight + delta));
        const ratio = available ? next / available : 0.5;
        setMidSplitRatio(ratio);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        window.removeEventListener("touchmove", onTouchMove);
        window.removeEventListener("touchend", onUp);
        document.body.style.cursor = "";
      };

      document.body.style.cursor = "row-resize";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("touchmove", onTouchMove, { passive: false });
      window.addEventListener("touchend", onUp);
    },
    [midSplitRatio]
  );

  const handleMidResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      startMidResize(event.clientY);
    },
    [startMidResize]
  );

  const handleMidMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      startMidResize(event.clientY);
    },
    [startMidResize]
  );

  const handleMidTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      const touch = event.touches[0];
      if (!touch) return;
      startMidResize(touch.clientY);
    },
    [startMidResize]
  );

  const handleRightPanelResizeStart = useCallback(
    (index: number, event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const first = rightPanels[index];
      const second = rightPanels[index + 1];
      if (!first || !second) return;
      if (first.collapsed || second.collapsed) return;

      const startY = event.clientY;
      const startFirst = first.size;
      const startSecond = second.size;
      const min = RIGHT_PANEL_MIN_HEIGHT;

      const onMove = (e: PointerEvent) => {
        const delta = e.clientY - startY;
        const total = startFirst + startSecond;
        const nextFirst = Math.min(total - min, Math.max(min, startFirst + delta));
        const nextSecond = total - nextFirst;
        setRightPanels((prev) => {
          if (!prev[index] || !prev[index + 1]) return prev;
          if (prev[index].collapsed || prev[index + 1].collapsed) return prev;
          const next = [...prev];
          next[index] = { ...next[index], size: nextFirst };
          next[index + 1] = { ...next[index + 1], size: nextSecond };
          return next;
        });
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
      };

      document.body.style.cursor = "row-resize";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [rightPanels]
  );

  const startNodeDrag = useCallback(
    (id: string, clientX: number, clientY: number) => {
      const startOffset = nodeOffsetsRef.current[id] ?? { x: 0, y: 0 };
      const startX = clientX;
      const startY = clientY;

      const onMove = (e: PointerEvent | MouseEvent) => {
        const dx = (e.clientX - startX) / (vizScale || 1);
        const dy = (e.clientY - startY) / (vizScale || 1);
        setNodeOffsets((prev) => ({
          ...prev,
          [id]: { x: startOffset.x + dx, y: startOffset.y + dy },
        }));
      };

      const onTouchMove = (e: TouchEvent) => {
        const touch = e.touches[0];
        if (!touch) return;
        const dx = (touch.clientX - startX) / (vizScale || 1);
        const dy = (touch.clientY - startY) / (vizScale || 1);
        setNodeOffsets((prev) => ({
          ...prev,
          [id]: { x: startOffset.x + dx, y: startOffset.y + dy },
        }));
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        window.removeEventListener("touchmove", onTouchMove);
        window.removeEventListener("touchend", onUp);
        document.body.style.cursor = "";
      };

      document.body.style.cursor = "grabbing";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("touchmove", onTouchMove, { passive: false });
      window.addEventListener("touchend", onUp);
    },
    [vizScale]
  );

  const handleNodePointerDown = useCallback(
    (id: string, event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      startNodeDrag(id, event.clientX, event.clientY);
    },
    [startNodeDrag]
  );

  const handleNodeMouseDown = useCallback(
    (id: string, event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      startNodeDrag(id, event.clientX, event.clientY);
    },
    [startNodeDrag]
  );

  const handleNodeTouchStart = useCallback(
    (id: string, event: ReactTouchEvent<HTMLDivElement>) => {
      event.stopPropagation();
      const touch = event.touches[0];
      if (!touch) return;
      startNodeDrag(id, touch.clientX, touch.clientY);
    },
    [startNodeDrag]
  );

  const summarizeHistoryEntry = useCallback((entry: any, index: number, opts?: { omitRole?: boolean }) => {
    const role = typeof entry?.role === "string" ? entry.role : "unknown";
    const toolCalls = Array.isArray(entry?.tool_calls) ? entry.tool_calls.length : 0;
    const toolName =
      typeof entry?.name === "string"
        ? entry.name
        : typeof entry?.tool_call_id === "string"
          ? entry.tool_call_id.slice(0, 6)
          : "";
    let contentText = "";
    if (typeof entry?.content === "string") {
      contentText = entry.content;
    } else if (entry?.content != null) {
      try {
        contentText = JSON.stringify(entry.content);
      } catch {
        contentText = String(entry.content);
      }
    }
    contentText = contentText.replace(/\s+/g, " ").slice(0, 80);
    const metaParts: string[] = [];
    if (!opts?.omitRole) metaParts.push(role);
    if (role === "tool" && toolName) {
      metaParts.push(toolName);
    } else if (toolCalls > 0) {
      metaParts.push(`tool_calls:${toolCalls}`);
    }
    const meta = metaParts.join(" · ");
    const prefix = meta ? `#${index + 1} ${meta}` : `#${index + 1}`;
    return contentText ? `${prefix} — ${contentText}` : prefix;
  }, []);

  const historyRole = useCallback((entry: any) => {
    return typeof entry?.role === "string" ? entry.role : "unknown";
  }, []);

  const historyAccent = useCallback((role?: string) => {
    if (!role) return "#94a3b8";
    if (role === "human") return "#f8fafc";
    if (role === "assistant") return "#38bdf8";
    if (role === "productmanager") return "#fb7185";
    if (role === "coder") return "#34d399";
    if (role === "tool") return "#fbbf24";
    if (role === "system") return "#a78bfa";
    return "#94a3b8";
  }, []);

  const title = getGroupLabel(activeGroup);

  const toggleAgentCollapsed = useCallback((agentId: string) => {
    setCollapsedAgents((prev) => ({ ...prev, [agentId]: !prev[agentId] }));
  }, []);

  const renderGroupRow = (
    g: Group,
    tree?: {
      depth: number;
      hasChildren: boolean;
      collapsed: boolean;
      agentId: string;
      guides: boolean[];
      isLast: boolean;
    }
  ) => {
    const guideWidth = 14;
    const caretWidth = 18;
    const caretGap = 6;
    const depth = tree?.depth ?? 0;
    const prefixWidth = depth > 0 ? depth * guideWidth + guideWidth : 0;
    const previewIndent = tree ? prefixWidth + caretWidth + caretGap : 0;
    return (
      <button
        key={g.id}
        className={cx("row", g.id === activeGroupId && "active")}
        onClick={() => {
          setActiveGroupId(g.id);
        }}
        style={{ paddingLeft: 16 }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {tree && tree.depth > 0 ? (
              <span className="tree-prefix">
                {tree.guides.map((hasLine, idx) => (
                  <span
                    key={`${g.id}-guide-${idx}`}
                    className={hasLine ? "tree-line" : "tree-blank"}
                  />
                ))}
                <span className={tree.isLast ? "tree-elbow last" : "tree-elbow"} />
              </span>
            ) : null}
            {tree?.hasChildren ? (
              <button
                type="button"
                className="tree-caret"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleAgentCollapsed(tree.agentId);
                }}
                title={tree.collapsed ? "展开" : "收起"}
              >
                {tree.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
              </button>
            ) : tree ? (
              <span className="tree-caret-placeholder" />
            ) : null}
            <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {getGroupLabel(g)}
            </div>
          </div>
          {g.unreadCount > 0 && <span className="badge">{g.unreadCount}</span>}
        </div>
        {g.lastMessage ? (
          <div
            className="muted"
            style={{
              fontSize: 12,
              marginTop: 6,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginLeft: previewIndent,
            }}
          >
            {g.lastMessage.content}
          </div>
        ) : null}
        {g.contextTokens > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, marginBottom: 2 }}>
              <span className="muted">Context</span>
              <span className="mono" style={{ color: (g.contextTokens / tokenLimit) > 0.8 ? "#ef4444" : (g.contextTokens / tokenLimit) > 0.5 ? "#facc15" : "#22c55e" }}>
                {g.contextTokens.toLocaleString()}
                <span className="muted" style={{ marginLeft: 4 }}>/ {tokenLimit.toLocaleString()}</span>
              </span>
            </div>
            <div style={{ height: 3, background: "#27272a", borderRadius: 2, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.min(100, (g.contextTokens / tokenLimit) * 100)}%`,
                  background: (g.contextTokens / tokenLimit) > 0.8 ? "#ef4444" : (g.contextTokens / tokenLimit) > 0.5 ? "#facc15" : "#22c55e",
                  borderRadius: 2,
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          </div>
        )}
      </button>
    );
  };

  return (
    <IMShell
      left={
        <aside className="panel panel-left">
        <div className="header">
          <div>
            <div style={{ fontWeight: 700 }}>Workspace</div>
            <div className="muted mono" style={{ fontSize: 12 }}>
              {session?.workspaceId ?? "-"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }} />
        </div>

        <div style={{ padding: 12 }}>
          <div className="muted mono" style={{ fontSize: 12, lineHeight: 1.4 }}>
            human: {session?.humanAgentId ?? "-"}
            <br />
            assistant: {session?.assistantAgentId ?? "-"}
          </div>
        </div>

        <div className="list">
          {agentTreeRows.length === 0 && extraGroups.length === 0 ? (
            <div style={{ padding: 16 }} className="muted">
              No groups yet.
            </div>
          ) : (
            <>
              {agentTreeRows.map(({ agent, group, depth, hasChildren, collapsed, guides, isLast }) =>
                group
                  ? renderGroupRow(group, {
                      depth,
                      hasChildren,
                      collapsed,
                      agentId: agent.id,
                      guides,
                      isLast,
                    })
                  : null
              )}
              {extraGroups.map((g) => renderGroupRow(g))}
            </>
          )}
        </div>
        </aside>
      }
      mid={
        <main className="panel panel-mid">
        <div className="header">
          <div style={{ fontWeight: 700 }}>{title}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {status !== "idle" ? `${status}...` : ""}
          </div>
        </div>

        <div className="mid-stack" ref={midStackRef} style={{
          gridTemplateRows: midStackHeight > 0
            ? `${Math.max(0, Math.round(midChatHeight))}px ${MID_SPLITTER_SIZE}px minmax(${MID_GRAPH_MIN_HEIGHT}px, 1fr)`
            : `1fr ${MID_SPLITTER_SIZE}px minmax(${MID_GRAPH_MIN_HEIGHT}px, 1fr)`
        }}>
          <div className="chat">
            <IMMessageList
              messages={messages}
              humanAgentId={session?.humanAgentId ?? null}
              agentRoleById={agentRoleById}
              fmtTime={fmtTime}
              renderContent={(content) => <MarkdownContent content={content} />}
              cx={cx}
            />
            <div ref={bottomRef} />
          </div>

          <div
            className="mid-resizer"
            onPointerDown={handleMidResizeStart}
            onMouseDown={handleMidMouseDown}
            onTouchStart={handleMidTouchStart}
          />

          <div className="viz-shell">
            <div
              ref={vizRef}
              className="viz-canvas"
              style={{
                position: "relative",
                minHeight: 200,
                borderTop: "1px solid #27272a",
                background:
                  "radial-gradient(circle at 20% 20%, rgba(56,189,248,0.12), transparent 40%), radial-gradient(circle at 80% 70%, rgba(34,197,94,0.12), transparent 45%), linear-gradient(transparent 23px, rgba(39,39,42,0.35) 24px), linear-gradient(90deg, transparent 23px, rgba(39,39,42,0.35) 24px), #050505",
                backgroundSize: "24px 24px, 24px 24px, 24px 24px, 24px 24px, auto",
                cursor: vizIsPanning ? "grabbing" : "grab",
                overflow: "hidden",
              }}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                setVizIsPanning(true);
                vizPanStartRef.current = { x: e.clientX, y: e.clientY, ox: vizOffset.x, oy: vizOffset.y };
              }}
              onMouseMove={(e) => {
                if (!vizIsPanning || !vizPanStartRef.current) return;
                const dx = e.clientX - vizPanStartRef.current.x;
                const dy = e.clientY - vizPanStartRef.current.y;
                setVizOffset({ x: vizPanStartRef.current.ox + dx, y: vizPanStartRef.current.oy + dy });
              }}
              onMouseUp={() => {
                setVizIsPanning(false);
                vizPanStartRef.current = null;
              }}
              onMouseLeave={() => {
                setVizIsPanning(false);
                vizPanStartRef.current = null;
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 12,
                  top: 12,
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #27272a",
                  background: "rgba(9,9,11,0.7)",
                  fontSize: 12,
                  color: "#e4e4e7",
                }}
              >
                <span className="mono">缩放 {Math.round(vizScale * 100)}%</span>
                <button
                  className="btn"
                  style={{ padding: "2px 8px", fontSize: 12 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setVizScale((s) => Math.min(s + 0.1, 2));
                  }}
                >
                  +
                </button>
                <button
                  className="btn"
                  style={{ padding: "2px 8px", fontSize: 12 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setVizScale((s) => Math.max(s - 0.1, 0.5));
                  }}
                >
                  -
                </button>
                <button
                  className="btn"
                  style={{ padding: "2px 8px", fontSize: 12 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setVizScale(0.9);
                    setVizOffset({ x: 0, y: 0 });
                  }}
                >
                  Reset
                </button>
                <span className="muted mono">Ctrl/⌘ + 滚轮缩放</span>
              </div>

              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  transform: `translate(${vizOffset.x}px, ${vizOffset.y}px) scale(${vizScale})`,
                  transformOrigin: "center center",
                  transition: vizIsPanning ? "none" : "transform 120ms ease-out",
                }}
              >
                <svg
                  width={vizSize.width}
                  height={vizSize.height}
                  style={{ position: "absolute", inset: 0 }}
                >
                  <g>
                    {vizLayout.edges.map((edge) => {
                      const from = vizLayout.positions.get(edge.fromId);
                      const to = vizLayout.positions.get(edge.toId);
                      if (!from || !to) return null;
                      const midY = (from.y + to.y) / 2;
                      const path = `M ${from.x} ${from.y} L ${from.x} ${midY} L ${to.x} ${midY} L ${to.x} ${to.y}`;
                      return (
                        <path
                          key={`${edge.fromId}-${edge.toId}`}
                          d={path}
                          stroke="rgba(148,163,184,0.35)"
                          strokeWidth={1.2}
                          fill="none"
                        />
                      );
                    })}
                  </g>
                  <AnimatePresence>
                    {vizBeams.map((beam) => {
                      const from = vizLayout.positions.get(beam.fromId);
                      const to = vizLayout.positions.get(beam.toId);
                      if (!from || !to) return null;
                      const color = beam.kind === "create" ? "#3b82f6" : "#ffffff";
                      return (
                        <motion.g
                          key={beam.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 0.9 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.6 }}
                        >
                          <motion.line
                            x1={from.x}
                            y1={from.y}
                            x2={to.x}
                            y2={to.y}
                            stroke={color}
                            strokeWidth={beam.kind === "create" ? 2.5 : 1.6}
                            strokeDasharray={beam.kind === "create" ? "8 6" : "0"}
                            initial={{ pathLength: 0, opacity: 0 }}
                            animate={{ pathLength: 1, opacity: beam.kind === "create" ? 0.5 : 0.35 }}
                            transition={{ duration: 0.5 }}
                          />
                          <motion.circle
                            r={beam.kind === "create" ? 7 : 4}
                            fill={color}
                            initial={{ cx: from.x, cy: from.y }}
                            animate={{ cx: to.x, cy: to.y }}
                            transition={{ duration: 0.8, ease: "easeInOut" }}
                            style={{ filter: `drop-shadow(0 0 ${beam.kind === "create" ? "12px" : "5px"} ${color})` }}
                          />
                          {beam.label ? (
                            <foreignObject
                              x={(from.x + to.x) / 2 - 80}
                              y={(from.y + to.y) / 2 - 40}
                              width={160}
                              height={40}
                            >
                              <div
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: beam.kind === "create" ? "#bfdbfe" : "#e4e4e7",
                                  border: `1px solid ${beam.kind === "create" ? "rgba(59,130,246,0.5)" : "rgba(82,82,91,0.5)"}`,
                                  background:
                                    beam.kind === "create"
                                      ? "rgba(30,58,138,0.6)"
                                      : "rgba(9,9,11,0.7)",
                                  borderRadius: 999,
                                  padding: "4px 8px",
                                  textAlign: "center",
                                }}
                              >
                                {beam.kind === "create" ? `create_agent(${beam.label})` : "send_message"}
                              </div>
                            </foreignObject>
                          ) : null}
                        </motion.g>
                      );
                    })}
                  </AnimatePresence>
                </svg>

                {vizLayout.ordered.map((agent) => {
                  const pos = vizLayout.positions.get(agent.id);
                  if (!pos) return null;
                  const status = agentStatusById[agent.id] ?? "IDLE";
                  const ring = statusColor(status);
                  const isHuman = agent.role === "human";
                  const isActive = streamAgentId === agent.id;
                  const Icon =
                    agent.role === "productmanager"
                      ? Briefcase
                      : agent.role === "coder"
                        ? Code2
                        : agent.role === "assistant"
                          ? Network
                          : User;
                  return (
                    <motion.div
                      key={agent.id}
                      initial={{ scale: 0, opacity: 0, x: pos.x, y: pos.y }}
                      animate={{ scale: 1, opacity: 1, x: pos.x, y: pos.y }}
                      transition={{ type: "spring", stiffness: 220, damping: 18 }}
                      className={cx("viz-node", isActive && "active")}
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        width: 90,
                        height: 90,
                        marginLeft: -45,
                        marginTop: -45,
                        cursor: "grab",
                      }}
                      title={agent.id}
                      onPointerDown={(e) => handleNodePointerDown(agent.id, e)}
                      onMouseDown={(e) => handleNodeMouseDown(agent.id, e)}
                      onTouchStart={(e) => handleNodeTouchStart(agent.id, e)}
                    >
                      {isActive ? (
                        <div className="viz-reticle">
                          <div className="viz-reticle-pulse" />
                        </div>
                      ) : null}
                      <div
                        style={{
                          width: 90,
                          height: 90,
                          borderRadius: "50%",
                          border: `2px solid ${ring}`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "rgba(5,5,5,0.9)",
                          boxShadow: `0 0 30px ${ring}55`,
                          position: "relative",
                        }}
                      >
                        <div
                          style={{
                            width: 70,
                            height: 70,
                            borderRadius: "50%",
                            border: `2px solid ${isHuman ? "#f8fafc" : "#4ade80"}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "rgba(0,0,0,0.6)",
                          }}
                        >
                          <Icon size={24} color={isHuman ? "#f8fafc" : "#e4e4e7"} />
                        </div>
                        {status === "BUSY" ? (
                          <motion.div
                            style={{
                              position: "absolute",
                              inset: 6,
                              borderRadius: "50%",
                              border: "2px solid #ef4444",
                              borderTopColor: "transparent",
                              borderRightColor: "transparent",
                            }}
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                          />
                        ) : null}
                      </div>
                      <div
                        style={{
                          position: "absolute",
                          top: 94,
                          left: "50%",
                          transform: "translateX(-50%)",
                          textAlign: "center",
                          width: 120,
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#e4e4e7",
                        }}
                      >
                        {agent.role}
                        <div style={{ fontSize: 9, color: ring, marginTop: 2 }}>{status}</div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            <div className={cx("viz-events", vizEventsCollapsed && "collapsed")}>
              {!vizEventsCollapsed ? (
                <>
                  <div style={{ fontWeight: 700, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>事件流</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="muted mono">{vizEvents.length}</span>
                      <button
                        type="button"
                        className="viz-events-toggle"
                        onClick={() => setVizEventsCollapsed(true)}
                        title="收起"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                  {vizEvents.length === 0 ? (
                    <div className="muted">暂无事件</div>
                  ) : (
                    vizEvents
                      .slice(-6)
                      .reverse()
                      .map((evt) => (
                        <div
                          key={evt.id}
                          style={{
                            marginBottom: 8,
                            paddingBottom: 8,
                            borderBottom: "1px solid rgba(39,39,42,0.6)",
                          }}
                        >
                          <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: 999,
                                background:
                                  evt.kind === "agent"
                                    ? "#60a5fa"
                                    : evt.kind === "message"
                                      ? "#fbbf24"
                                      : evt.kind === "llm"
                                        ? "#38bdf8"
                                        : evt.kind === "tool"
                                          ? "#f97316"
                                          : "#a855f7",
                                boxShadow: "0 0 8px rgba(0,0,0,0.5)",
                              }}
                            />
                            <span>{evt.label}</span>
                          </div>
                          <div className="muted mono" style={{ fontSize: 11, marginTop: 4 }}>
                            {new Date(evt.at).toLocaleTimeString()}
                          </div>
                        </div>
                      ))
                  )}
                </>
              ) : null}
            </div>
            {vizEventsCollapsed ? (
              <button
                type="button"
                className="viz-events-toggle floating"
                onClick={() => setVizEventsCollapsed(false)}
                title="展开"
              >
                <ChevronLeft size={16} />
              </button>
            ) : null}
          </div>
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
      }
      right={
        <>
          <section className="panel panel-right">
        <div className="header">
          <div style={{ fontWeight: 700 }}>Agent Details</div>
        </div>

        <div className="agent-sidebar-body">
          <div className="muted" style={{ fontSize: 12 }}>
            Streaming from: <span className="mono">{streamAgentId ?? "-"}</span>
          </div>
          {agentError ? (
            <div
              className="toast"
              style={{ borderColor: "#713f12", background: "rgba(113,63,18,0.25)", color: "#fde68a" }}
            >
              {agentError}
            </div>
          ) : null}

          <div className="agent-panels">
            {rightPanels.map((panel, idx) => (
              <Fragment key={panel.id}>
                <div
                  className={cx("agent-panel", panel.collapsed && "collapsed")}
                  style={
                    panel.collapsed
                      ? { flex: `0 0 ${RIGHT_PANEL_HEADER_HEIGHT}px`, height: RIGHT_PANEL_HEADER_HEIGHT }
                      : { flex: `1 1 ${panel.size}px`, minHeight: RIGHT_PANEL_MIN_HEIGHT }
                  }
                >
                  <button
                    className="agent-panel-header"
                    type="button"
                    onClick={() => toggleRightPanel(panel.id)}
                  >
                    <span className="agent-panel-caret">{panel.collapsed ? "▸" : "▾"}</span>
                    <span>{panel.title}</span>
                  </button>
                  {!panel.collapsed ? (
                    <div className={cx("agent-panel-body", "mono")}>
                      {panel.id === "history" ? (
                        Array.isArray(llmHistoryParsed) ? (
                          <IMHistoryList
                            entries={llmHistoryParsed}
                            historyRole={historyRole}
                            historyAccent={historyAccent}
                            summarizeHistoryEntry={summarizeHistoryEntry}
                          />
                        ) : (
                          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                            {llmHistoryFormatted || "—"}
                          </pre>
                        )
                      ) : panel.id === "content" ? (
                        <MarkdownContent content={contentStream} />
                      ) : panel.id === "reasoning" ? (
                        <MarkdownContent content={reasoningStream} />
                      ) : (
                        <MarkdownContent content={toolStream} />
                      )}
                    </div>
                  ) : null}
                </div>
                {idx < rightPanels.length - 1 ? (
                  <div
                    className={cx(
                      "agent-panel-resizer",
                      (panel.collapsed || rightPanels[idx + 1]?.collapsed) && "disabled"
                    )}
                    onPointerDown={(e) => handleRightPanelResizeStart(idx, e)}
                  />
                ) : null}
              </Fragment>
            ))}
          </div>
        </div>
          </section>
          <style jsx global>{`
        @keyframes viz-dash {
          from {
            stroke-dashoffset: 18;
          }
          to {
            stroke-dashoffset: 0;
          }
        }
      `}</style>
        </>
      }
    />
  );
}
