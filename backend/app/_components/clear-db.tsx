"use client";

import { useState } from "react";

const SESSION_KEY = "agent-wechat.session.v1";

export default function ClearDbButton() {
  const [busy, setBusy] = useState<"pg" | "rt" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onClearPostgres() {
    if (busy) return;
    setError(null);

    const ok = window.confirm(
      "This will DELETE all workspaces, agents, groups, and messages in Postgres. Continue?"
    );
    if (!ok) return;

    setBusy("pg");
    try {
      await fetch("/api/admin/clear-db", { method: "POST" });
      await fetch("/api/admin/init-db", { method: "POST" });
      try {
        localStorage.removeItem(SESSION_KEY);
      } catch {
        // ignore
      }
      window.location.href = "/";
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onClearRealtime() {
    if (busy) return;
    setError(null);

    const ok = window.confirm(
      "This will DELETE all agent/ui stream history in Upstash. Continue?"
    );
    if (!ok) return;

    setBusy("rt");
    try {
      await fetch("/api/admin/clear-realtime", { method: "POST" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <button className="btn" onClick={() => void onClearPostgres()} disabled={busy !== null}>
        {busy === "pg" ? "Clearing..." : "Clear Postgres"}
      </button>
      <button className="btn" onClick={() => void onClearRealtime()} disabled={busy !== null}>
        {busy === "rt" ? "Clearing..." : "Clear Realtime"}
      </button>
      {error ? (
        <span className="muted" style={{ color: "#fecaca", fontSize: 13 }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
