"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type UUID = string;

type WorkspaceDefaults = {
  workspaceId: UUID;
  humanAgentId: UUID;
  assistantAgentId: UUID;
  defaultGroupId: UUID;
};

type Message = {
  id: UUID;
  senderId: UUID;
  content: string;
  contentType: string;
  sendTime: string;
};

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

async function api<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export default function GraphPage() {
  const [session] = useState<WorkspaceDefaults | null>(() => loadSession());
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    void (async () => {
      try {
        const q = new URLSearchParams({ markRead: "false", readerId: session.humanAgentId });
        const { messages } = await api<{ messages: Message[] }>(
          `/api/groups/${session.defaultGroupId}/messages?${q.toString()}`
        );
        setMessages(messages);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [session]);

  const stats = useMemo(() => {
    if (!session) return null;
    let humanToAssistant = 0;
    let assistantToHuman = 0;
    for (const m of messages) {
      if (m.senderId === session.humanAgentId) humanToAssistant++;
      if (m.senderId === session.assistantAgentId) assistantToHuman++;
    }
    return { humanToAssistant, assistantToHuman };
  }, [messages, session]);

  if (!session) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Agent Graph</h1>
        <p className="muted">No session yet. Open IM first.</p>
        <Link className="btn btn-primary" href="/im">
          Open IM
        </Link>
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Agent Graph (stub)</h1>
          <p className="muted" style={{ marginTop: 8 }}>
            Default P2P only (counts messages). Full event graph comes next.
          </p>
        </div>
        <Link className="btn" href="/im">
          Back to IM
        </Link>
      </div>

      {error ? <div className="toast">{error}</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 320px))", gap: 12, marginTop: 16 }}>
        <div className="card">
          <div className="card-title">Human → Assistant</div>
          <div className="card-body" style={{ fontSize: 28, fontWeight: 700 }}>
            {stats?.humanToAssistant ?? 0}
          </div>
        </div>
        <div className="card">
          <div className="card-title">Assistant → Human</div>
          <div className="card-body" style={{ fontSize: 28, fontWeight: 700 }}>
            {stats?.assistantToHuman ?? 0}
          </div>
        </div>
      </div>
    </div>
  );
}

