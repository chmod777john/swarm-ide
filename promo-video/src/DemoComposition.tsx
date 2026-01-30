import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
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
  const sequenceFrame = frame - state.sequenceStart;

  const tiltEnd = 2.4 * fps;
  const toolCps = 30;
  const toolStreamEnd = state.toolTimeline.reduce((max, item) => {
    const framesToFinish = (item.label.length / toolCps) * fps;
    return Math.max(max, item.appearAt + framesToFinish);
  }, tiltEnd);
  const flipStart = toolStreamEnd + 0.2 * fps;
  const flipEnd = flipStart + 0.7 * fps;

  const tiltProgress = interpolate(frame, [0, 1.2 * fps, tiltEnd], [0, 1, 0], {
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.2, 0.8, 0.2, 1),
  });
  const microFade = interpolate(frame, [tiltEnd - 0.2 * fps, tiltEnd], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const microX = Math.sin((frame / fps) * 0.6) * 1.4 * microFade;
  const microY = Math.cos((frame / fps) * 0.5) * 1.1 * microFade;
  const tiltX = -22 * tiltProgress + microX;
  const tiltY = 16 * tiltProgress + microY;
  const tiltZ = 60 * tiltProgress;
  const stageScale = 1 - 0.08 * tiltProgress;
  const leftDepth = 320 * tiltProgress;
  const midDepth = 640 * tiltProgress;
  const rightDepth = 480 * tiltProgress;

  const flipProgress = interpolate(frame, [flipStart, flipEnd], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.2, 0.7, 0.2, 1),
  });
  const frontRotate = 180 * flipProgress;
  const backRotate = -180 + 180 * flipProgress;
  const graphFrame = frame - flipEnd;

  const pulseFrames = 2 * fps;
  const pulseT = (frame % pulseFrames) / pulseFrames;
  const pulseScale = interpolate(pulseT, [0, 0.7, 1], [1, 1.08, 1.12]);
  const pulseOpacity = interpolate(pulseT, [0, 0.7, 1], [0.9, 0.5, 0]);

  const typewriter = (text: string, startFrame: number, cps = 22) => {
    const elapsed = frame - startFrame;
    if (elapsed <= 0) return "";
    const chars = Math.max(0, Math.floor((elapsed * cps) / fps));
    return text.slice(0, chars);
  };

  const toFrames = (seconds: number) => Math.round(seconds * fps);
  const contentSegments = [
    { start: 0, text: "等待用户输入..." },
    { start: state.sequenceStart + toFrames(1.2), text: "已创建 coder，并建立对话。" },
    { start: state.sequenceStart + toFrames(2.8), text: "coder 已回复：任务完成 40%。" },
  ];
  const reasoningSegments = [
    { start: 0, text: "分析用户意图，准备创建子 agent。" },
    { start: state.sequenceStart + toFrames(1.2), text: "创建 coder 并建立 P2P 群组。" },
    { start: state.sequenceStart + toFrames(2.8), text: "汇总 coder 回复并反馈给用户。" },
  ];

  const getCurrentSegment = (segments: Array<{ start: number; text: string }>) => {
    let current = segments[0];
    for (const seg of segments) {
      if (frame >= seg.start) current = seg;
    }
    return current;
  };

  const currentContent = getCurrentSegment(contentSegments);
  const currentReasoning = getCurrentSegment(reasoningSegments);
  const contentStreaming = typewriter(currentContent.text, currentContent.start, 26);
  const reasoningStreaming = typewriter(currentReasoning.text, currentReasoning.start, 24);

  const statusColor = (status?: string) => {
    if (status === "BUSY") return "#ef4444";
    if (status === "WAKING") return "#facc15";
    return "#22c55e";
  };

  const nodeStatusAt = (nodeId: string, time: number) => {
    for (const slot of state.nodeStatusTimeline) {
      if (slot.id === nodeId && time >= slot.start && time <= slot.end) return "BUSY";
    }
    return "IDLE";
  };

  const appearProgress = (time: number, start: number) => {
    const safeFrame = Math.max(0, time - start);
    return spring({
      frame: safeFrame,
      fps,
      durationInFrames: 18,
      config: { damping: 18, stiffness: 160 },
    });
  };

  const edgeOpacityAt = (time: number, start: number) =>
    interpolate(time, [start, start + 8], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  const messagePulseAt = (time: number, start: number, end: number) =>
    interpolate(time, [start, end], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  const pointAlongPath = (
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    progress: number
  ) => {
    const midY = (fromY + toY) / 2;
    const seg1 = Math.abs(midY - fromY);
    const seg2 = Math.abs(toX - fromX);
    const seg3 = Math.abs(toY - midY);
    const total = Math.max(1, seg1 + seg2 + seg3);
    const dist = total * progress;
    const dirY1 = midY >= fromY ? 1 : -1;
    const dirX = toX >= fromX ? 1 : -1;
    const dirY2 = toY >= midY ? 1 : -1;

    if (dist <= seg1) {
      return { x: fromX, y: fromY + dirY1 * dist };
    }
    if (dist <= seg1 + seg2) {
      return { x: fromX + dirX * (dist - seg1), y: midY };
    }
    return { x: toX, y: midY + dirY2 * (dist - seg1 - seg2) };
  };

  const renderNode = (
    node: { id: string; label: string; x: number; y: number },
    x: number,
    y: number,
    size: number,
    time: number
  ) => {
    if (time < node.appearAt) return null;
    const appear = appearProgress(time, node.appearAt);
    const scale = interpolate(appear, [0, 1], [0.6, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const opacity = interpolate(appear, [0, 1], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const role = state.agentRoleById.get(node.id) ?? node.label;
    const isHuman = role === "human";
    const isActive = node.id === activeNodeId;
    const status = nodeStatusAt(node.id, time);
    const ring = statusColor(status);
    const busyRotation = ((frame / fps) * 360) % 360;
    const Icon =
      role === "productmanager"
        ? Briefcase
        : role === "coder"
          ? Code2
          : role === "assistant"
            ? Network
            : User;
    const outer = size;
    const inner = size * 0.78;

    return (
      <div
        key={node.id}
        className={cx("viz-node", isActive && "active")}
        style={{
          position: "absolute",
          left: x,
          top: y,
          width: outer,
          height: outer,
          transform: `translate(-50%, -50%) scale(${scale})`,
          opacity,
        }}
      >
        {isActive ? (
          <div className="viz-reticle">
            <div
              style={{
                position: "absolute",
                inset: -12,
                borderRadius: 999,
                border: "2px solid rgba(56, 189, 248, 0.35)",
                transform: `scale(${pulseScale})`,
                opacity: pulseOpacity,
              }}
            />
          </div>
        ) : null}
        <div
          style={{
            width: outer,
            height: outer,
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
              width: inner,
              height: inner,
              borderRadius: "50%",
              border: `2px solid ${isHuman ? "#f8fafc" : "#4ade80"}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.6)",
            }}
          >
            <Icon size={Math.max(18, Math.round(outer * 0.26))} color={isHuman ? "#f8fafc" : "#e4e4e7"} />
          </div>
          {status === "BUSY" ? (
            <div
              style={{
                position: "absolute",
                inset: Math.max(4, Math.round(outer * 0.08)),
                borderRadius: "50%",
                border: "2px solid #ef4444",
                borderTopColor: "transparent",
                borderRightColor: "transparent",
                transform: `rotate(${busyRotation}deg)`,
              }}
            />
          ) : null}
        </div>
        <div
          style={{
            position: "absolute",
            top: outer + 4,
            left: "50%",
            transform: "translateX(-50%)",
            textAlign: "center",
            width: outer + 30,
            fontSize: Math.max(10, Math.round(outer * 0.12)),
            fontWeight: 700,
            color: "#e4e4e7",
          }}
        >
          {node.label}
          <div style={{ fontSize: Math.max(9, Math.round(outer * 0.1)), color: ring, marginTop: 2 }}>
            {status}
          </div>
        </div>
      </div>
    );
  };

  const renderEdges = (
    nodes: Array<{ id: string; x: number; y: number }>,
    edges: Array<{ id: string; from: string; to: string; appearAt: number }>,
    time: number,
    mapX: (value: number) => number,
    mapY: (value: number) => number,
    stroke: string
  ) => {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    return (
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
        {edges.map((edge) => {
          if (time < edge.appearAt) return null;
          const from = nodeMap.get(edge.from);
          const to = nodeMap.get(edge.to);
          if (!from || !to) return null;
          const fromX = mapX(from.x);
          const fromY = mapY(from.y);
          const toX = mapX(to.x);
          const toY = mapY(to.y);
          const midY = (fromY + toY) / 2;
          const path = `M ${fromX} ${fromY} L ${fromX} ${midY} L ${toX} ${midY} L ${toX} ${toY}`;
          return (
            <path
              key={edge.id}
              d={path}
              stroke={stroke}
              strokeWidth={1.6}
              strokeOpacity={edgeOpacityAt(time, edge.appearAt)}
              fill="none"
            />
          );
        })}
        {state.edgePulses.map((pulse) => {
          if (time < pulse.start || time > pulse.end) return null;
          const from = nodeMap.get(pulse.from);
          const to = nodeMap.get(pulse.to);
          if (!from || !to) return null;
          const fromX = mapX(from.x);
          const fromY = mapY(from.y);
          const toX = mapX(to.x);
          const toY = mapY(to.y);
          const progress = messagePulseAt(time, pulse.start, pulse.end);
          const point = pointAlongPath(fromX, fromY, toX, toY, progress);
          const midY = (fromY + toY) / 2;
          const path = `M ${fromX} ${fromY} L ${fromX} ${midY} L ${toX} ${midY} L ${toX} ${toY}`;
          return (
            <g key={pulse.id}>
              <path d={path} stroke="#38bdf8" strokeWidth={2.4} opacity={0.6} fill="none" />
              <circle cx={point.x} cy={point.y} r={6} fill="#38bdf8" />
              <circle cx={point.x} cy={point.y} r={12} fill="rgba(56,189,248,0.25)" />
            </g>
          );
        })}
      </svg>
    );
  };

  const GraphScene: React.FC = () => {
    const { width, height } = useVideoConfig();
    const nodes = state.graphNodes;
    const edges = state.graphEdges;
    if (nodes.length === 0) return null;

    let minX = nodes[0].x;
    let maxX = nodes[0].x;
    let minY = nodes[0].y;
    let maxY = nodes[0].y;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    }
    const padding = 140;
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
    const mapX = (x: number) => (x - minX) * scale + padding;
    const mapY = (y: number) => (y - minY) * scale + padding;

    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 20% 20%, rgba(56,189,248,0.12), transparent 40%), radial-gradient(circle at 80% 70%, rgba(34,197,94,0.12), transparent 45%), linear-gradient(transparent 23px, rgba(39,39,42,0.35) 24px), linear-gradient(90deg, transparent 23px, rgba(39,39,42,0.35) 24px), #050505",
          backgroundSize: "24px 24px, 24px 24px, 24px 24px, 24px 24px, auto",
        }}
      >
        <div style={{ position: "absolute", left: 24, top: 24, fontSize: 12, color: "#e4e4e7" }}>
          Swarm Graph
        </div>
        {renderEdges(nodes, edges, graphFrame, mapX, mapY, "rgba(148,163,184,0.5)")}
        {nodes
          .filter((node) => graphFrame >= node.appearAt)
          .map((node) => renderNode(node, mapX(node.x), mapY(node.y), 120, graphFrame))}
      </div>
    );
  };

  return (
    <AbsoluteFill
      style={{
        background:
          "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 35%, #bae6fd 70%, #f0abfc 100%)",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          perspective: 1600,
          transformStyle: "preserve-3d",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            position: "relative",
            transformStyle: "preserve-3d",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              transformStyle: "preserve-3d",
              transform: `rotateY(${frontRotate}deg)`,
              backfaceVisibility: "hidden",
            }}
          >
            <div
              style={{
                width: "100%",
                height: "100%",
                transformStyle: "preserve-3d",
                transform: `translateZ(${tiltZ}px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(${stageScale})`,
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  position: "relative",
                  background: "#050505",
                  boxShadow: "0 40px 120px rgba(0,0,0,0.6)",
                  transformStyle: "preserve-3d",
                }}
              >
                <IMShell
                  left={
                    <div style={{ transform: `translateZ(${leftDepth}px)`, transformStyle: "preserve-3d" }}>
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
                    </div>
                  }
                  mid={
                    <div style={{ transform: `translateZ(${midDepth}px)`, transformStyle: "preserve-3d" }}>
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
                              {renderEdges(
                                state.nodes,
                                state.edges,
                                sequenceFrame,
                                (value) => value,
                                (value) => value,
                                "rgba(148,163,184,0.35)"
                              )}

                              {state.nodes.map((node) => renderNode(node, node.x, node.y, 90, sequenceFrame))}
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
                    </div>
                  }
                  right={
                    <div style={{ transform: `translateZ(${rightDepth}px)`, transformStyle: "preserve-3d" }}>
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
                              <div className="mono">{contentStreaming}</div>
                            </Panel>
                            <Panel title="Reasoning">
                              <div className="mono">{reasoningStreaming}</div>
                            </Panel>
                            <Panel title="Tools">
                              <div className="mono">
                                {state.toolItems.map((item) => (
                                  <div key={item.id}>{typewriter(item.label, item.appearAt, 30)}</div>
                                ))}
                              </div>
                            </Panel>
                          </div>
                        </div>
                      </section>
                    </div>
                  }
                />
              </div>
            </div>
          </div>

          <div
            style={{
              position: "absolute",
              inset: 0,
              transformStyle: "preserve-3d",
              transform: `rotateY(${backRotate}deg)`,
              backfaceVisibility: "hidden",
            }}
          >
            <GraphScene />
          </div>
        </div>
      </div>
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
