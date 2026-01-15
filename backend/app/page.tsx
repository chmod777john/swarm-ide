import Link from "next/link";

import { store } from "@/lib/storage";

import ClearDbButton from "./_components/clear-db";
import CreateWorkspace from "./_components/create-workspace";

export default async function HomePage() {
  let workspaces:
    | Array<{ id: string; name: string; createdAt: string }>
    | null = null;
  let dbError: string | null = null;

  try {
    workspaces = await store.listWorkspaces();
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ margin: 0, fontSize: 20 }}>Agent Wechat</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        MVP UI
      </p>

      {dbError ? (
        <div className="toast">
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Database not ready</div>
          <div className="mono" style={{ whiteSpace: "pre-wrap" }}>
            {dbError}
          </div>
          <div style={{ marginTop: 10 }} className="mono">
            Try:
            <br />
            1) `cd backend && docker compose up -d`
            <br />
            2) `curl -X POST http://localhost:3017/api/admin/init-db`
            <br />
            3) refresh
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link className="btn btn-primary" href="/im">
          Open IM
        </Link>
        <Link className="btn" href="/graph">
          Open Graph
        </Link>
      </div>

      <div style={{ marginTop: 24 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Create Workspace</div>
        <CreateWorkspace />
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Admin</div>
        <ClearDbButton />
      </div>

      <div style={{ marginTop: 24 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Workspaces</div>
        <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 13 }}>
          Click to open IM with the selected workspace.
        </p>
        <WorkspacesList workspaces={workspaces ?? []} />
      </div>
    </div>
  );
}

function WorkspacesList({ workspaces }: { workspaces: Array<{ id: string; name: string; createdAt: string }> }) {
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
