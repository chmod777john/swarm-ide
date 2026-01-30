import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Briefcase, Code2, Network, User } from "lucide-react";
import { IMShell } from "../../backend/app/im/IMShell";
import { IMMessageList } from "../../backend/app/im/IMMessageList";
import { IMHistoryList } from "../../backend/app/im/IMHistoryList";
import { getDemoState } from "./demo/timeline";

const cx = (...classes: Array<string | false | undefined | null>) =>
  classes.filter(Boolean).join(" ");

export const DemoComposition: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const state = getDemoState(frame, fps);
  const activeNodeId = state.selectedGroupId === "g-human" ? "assistant" : "coder";

  const statusColor = (status?: string) => {
    if (status === "BUSY") return "#ef4444";
    if (status === "WAKING") return "#facc15";
    return "#22c55e";
  };

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <IMShell
        left={
          <aside className="panel panel-left">
          <div className="header">
            <div>
              <div style={{ fontWeight: 700 }}>Workspace</div>
              <div className="muted mono" style={{ fontSize: 12 }}>
                {state.workspaceId}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }} />
          </div>

          <div style={{ padding: 12 }}>
            <div className="muted mono" style={{ fontSize: 12, lineHeight: 1.4 }}>
              human: {state.humanId}
              <br />
              assistant: {state.assistantId}
            </div>
          </div>

          <div className="list">
            {state.groups.map((group) => (
              <button
                key={group.id}
                className={cx("row", group.id === state.selectedGroupId && "active")}
              >
                <div style={{ fontWeight: 600 }}>{group.title}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {group.subtitle}
                </div>
              </button>
            ))}
          </div>
        </aside>
      }
      mid={
        <main className="panel panel-mid">
          <div className="header">
            <div style={{ fontWeight: 700 }}>{state.activeTitle}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              idle
            </div>
          </div>

          <div className="mid-stack">
          <div className="chat">
            <IMMessageList
              messages={state.messages}
              humanAgentId={state.humanId}
              agentRoleById={state.agentRoleById}
              fmtTime={(value) => value}
              renderContent={(content) => content}
              cx={cx}
            />
          </div>

            <div className="mid-resizer" />

            <div className="viz-shell">
              <div
                className="viz-canvas"
                style={{
                  position: "relative",
                  minHeight: 200,
                  borderTop: "1px solid #27272a",
                  background:
                    "radial-gradient(circle at 20% 20%, rgba(56,189,248,0.12), transparent 40%), radial-gradient(circle at 80% 70%, rgba(34,197,94,0.12), transparent 45%), linear-gradient(transparent 23px, rgba(39,39,42,0.35) 24px), linear-gradient(90deg, transparent 23px, rgba(39,39,42,0.35) 24px), #050505",
                  backgroundSize: "24px 24px, 24px 24px, 24px 24px, 24px 24px, auto",
                  overflow: "hidden",
                }}
              >
                <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
                  {state.edges.map((edge) => {
                    const from = state.nodes.find((n) => n.id === edge.from);
                    const to = state.nodes.find((n) => n.id === edge.to);
                    if (!from || !to) return null;
                    const midY = (from.y + to.y) / 2;
                    const path = `M ${from.x} ${from.y} L ${from.x} ${midY} L ${to.x} ${midY} L ${to.x} ${to.y}`;
                    return (
                      <path
                        key={edge.id}
                        d={path}
                        stroke="rgba(148,163,184,0.35)"
                        strokeWidth={1.2}
                        fill="none"
                      />
                    );
                  })}
                </svg>

                {state.nodes.map((node) => {
                  const role = state.agentRoleById.get(node.id) ?? node.label;
                  const isHuman = role === "human";
                  const isActive = node.id === activeNodeId;
                  const status = node.id === "assistant" && frame >= 150 && frame <= 210 ? "BUSY" : "IDLE";
                  const ring = statusColor(status);
                  const Icon =
                    role === "productmanager"
                      ? Briefcase
                      : role === "coder"
                        ? Code2
                        : role === "assistant"
                          ? Network
                          : User;

                  return (
                    <div
                      key={node.id}
                      className={cx("viz-node", isActive && "active")}
                      style={{
                        position: "absolute",
                        left: node.x,
                        top: node.y,
                        width: 90,
                        height: 90,
                        marginLeft: -45,
                        marginTop: -45,
                      }}
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
                          <div
                            style={{
                              position: "absolute",
                              inset: 6,
                              borderRadius: "50%",
                              border: "2px solid #ef4444",
                              borderTopColor: "transparent",
                              borderRightColor: "transparent",
                              animation: "spin 1s linear infinite",
                            }}
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
                        {role}
                        <div style={{ fontSize: 9, color: ring, marginTop: 2 }}>{status}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="composer">
            <textarea
              className="input textarea"
              value={state.draft}
              onChange={() => {}}
              placeholder="Type a message… (Ctrl/Cmd+Enter to send)"
            />
            <button className="btn btn-primary" type="button">
              Send
            </button>
          </div>
        </main>
      }
        right={
          <section className="panel panel-right">
          <div className="header">
            <div style={{ fontWeight: 700 }}>Agent Details</div>
          </div>

          <div className="agent-sidebar-body">
            <div className="muted" style={{ fontSize: 12 }}>
              Streaming from: <span className="mono">{state.assistantId}</span>
            </div>

            <div className="agent-panels">
              <Panel title="LLM History">
                <IMHistoryList
                  entries={state.historyEntries}
                  historyRole={state.historyRole}
                  historyAccent={state.historyAccent}
                  summarizeHistoryEntry={state.summarizeHistoryEntry}
                />
              </Panel>
              <Panel title="Content">
                <div className="mono">{state.contentText}</div>
              </Panel>
              <Panel title="Reasoning">
                <div className="mono">{state.reasoningText}</div>
              </Panel>
              <Panel title="Tools">
                <div className="mono">
                  {state.toolItems.map((item) => (
                    <div key={item.id}>{item.label}</div>
                  ))}
                </div>
              </Panel>
            </div>
          </div>
        </section>
        }
      />
    </AbsoluteFill>
  );
};

const Panel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  return (
    <div className="agent-panel">
      <div className="agent-panel-header">{title}</div>
      <div className="agent-panel-body mono">{children}</div>
    </div>
  );
};
