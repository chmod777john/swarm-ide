"use client";

import { useState } from "react";

const SESSION_KEY = "agent-wechat.session.v1";

export default function ClearDbButton() {
  const [busy, setBusy] = useState<"reset" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onReset() {
    if (busy) return;
    setError(null);

    const ok = window.confirm(
      "This will DELETE all data in Postgres and Redis, then re-init schema. Continue?"
    );
    if (!ok) return;

    setBusy("reset");
    try {
      await fetch("/api/admin/reset", { method: "POST" });
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

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <button className="btn" onClick={() => void onReset()} disabled={busy !== null}>
        {busy === "reset" ? "Resetting..." : "Reset DB + Redis"}
      </button>
      {error ? (
        <span className="muted" style={{ color: "#fecaca", fontSize: 13 }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
