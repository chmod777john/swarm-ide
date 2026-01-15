"use client";

import { useState } from "react";

const SESSION_KEY = "agent-wechat.session.v1";

export default function ClearDbButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClear() {
    if (busy) return;
    setError(null);

    const ok = window.confirm(
      "This will DELETE all workspaces, agents, groups, and messages. Continue?"
    );
    if (!ok) return;

    setBusy(true);
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
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <button className="btn" onClick={() => void onClear()} disabled={busy}>
        {busy ? "Clearing..." : "Clear DB"}
      </button>
      {error ? (
        <span className="muted" style={{ color: "#fecaca", fontSize: 13 }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

