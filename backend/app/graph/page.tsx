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

type GraphNode = { id: UUID; role: string; parentId: UUID | null };
type GraphEdge = { from: UUID; to: UUID; count: number; lastSendTime: string };

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
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    void (async () => {
      try {
        const q = new URLSearchParams({ workspaceId: session.workspaceId, limitMessages: "2000" });
        const res = await api<{ nodes: GraphNode[]; edges: GraphEdge[] }>(`/api/agent-graph?${q.toString()}`);
        setNodes(res.nodes);
        setEdges(res.edges);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [session]);

  const roleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of nodes) map.set(n.id, n.role);
    return map;
  }, [nodes]);

  const stats = useMemo(() => {
    const totalEdges = edges.length;
    const totalMessages = edges.reduce((sum, e) => sum + e.count, 0);
    return { totalEdges, totalMessages };
  }, [edges]);

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
          <h1 style={{ margin: 0, fontSize: 20 }}>Agent Graph</h1>
          <p className="muted" style={{ marginTop: 8 }}>
            Aggregated message flow (sender → all other group members).
          </p>
        </div>
        <Link className="btn" href="/im">
          Back to IM
        </Link>
      </div>

      {error ? <div className="toast">{error}</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 320px))", gap: 12, marginTop: 16 }}>
        <div className="card">
          <div className="card-title">Edges</div>
          <div className="card-body" style={{ fontSize: 28, fontWeight: 700 }}>
            {stats.totalEdges}
          </div>
        </div>
        <div className="card">
          <div className="card-title">Messages (aggregated)</div>
          <div className="card-body" style={{ fontSize: 28, fontWeight: 700 }}>
            {stats.totalMessages}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, maxWidth: 980 }}>
        <div className="card-title">Recent Flows</div>
        <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {edges.length === 0 ? (
            <div className="muted">No edges yet. Send some messages in IM.</div>
          ) : (
            edges.slice(0, 80).map((e) => {
              const fromLabel = roleById.get(e.from) ?? e.from.slice(0, 8);
              const toLabel = roleById.get(e.to) ?? e.to.slice(0, 8);
              return (
                <div key={`${e.from}=>${e.to}`} className="row" style={{ cursor: "default" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {fromLabel} → {toLabel}
                    </div>
                    <div className="muted mono" style={{ fontSize: 12 }}>
                      ×{e.count}
                    </div>
                  </div>
                  <div className="muted mono" style={{ fontSize: 12, marginTop: 6 }}>
                    last: {new Date(e.lastSendTime).toLocaleString()} • {e.from.slice(0, 8)} → {e.to.slice(0, 8)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
