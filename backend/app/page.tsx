import Link from "next/link";

export default function HomePage() {
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ margin: 0, fontSize: 20 }}>Agent Wechat</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        MVP UI
      </p>
      <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
        <Link className="btn btn-primary" href="/im">
          Open IM
        </Link>
        <Link className="btn" href="/graph">
          Open Graph
        </Link>
      </div>
    </div>
  );
}

