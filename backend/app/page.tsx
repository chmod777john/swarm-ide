import Link from "next/link";

import { store } from "@/lib/storage";

export default function HomePage() {
  const workspacesPromise = store.listWorkspaces();

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ margin: 0, fontSize: 20 }}>Agent Wechat</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        MVP UI
      </p>

      <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link className="btn btn-primary" href="/im">
          Open IM
        </Link>
        <Link className="btn" href="/graph">
          Open Graph
        </Link>
      </div>

      <div style={{ marginTop: 24 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Workspaces</div>
        <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 13 }}>
          Click to open IM with the selected workspace.
        </p>
        <WorkspacesList workspacesPromise={workspacesPromise} />
      </div>
    </div>
  );
}

async function WorkspacesList({
  workspacesPromise,
}: {
  workspacesPromise: ReturnType<typeof store.listWorkspaces>;
}) {
  const { workspaces } = await workspacesPromise.then((workspaces) => ({ workspaces }));

  if (workspaces.length === 0) {
    return <div className="muted">No workspaces yet. Open IM to create one.</div>;
  }

  return (
    <div className="card" style={{ maxWidth: 880 }}>
      <div className="card-title">Recent</div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {workspaces.map((w) => (
          <Link
            key={w.id}
            href={`/im?workspaceId=${encodeURIComponent(w.id)}`}
            className="row"
            style={{ textDecoration: "none" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontWeight: 600 }}>{w.name}</div>
              <div className="muted mono" style={{ fontSize: 12 }}>
                {new Date(w.createdAt).toLocaleString()}
              </div>
            </div>
            <div className="muted mono" style={{ fontSize: 12, marginTop: 6 }}>
              {w.id}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
