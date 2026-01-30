import type {
  DemoEdge,
  DemoGroup,
  DemoMessage,
  DemoNode,
  DemoPanelItem,
  DemoState,
} from "./types";

const workspaceId = "ws_demo_001";
const humanId = "human_001";
const assistantId = "assistant_001";
const coderId = "coder_001";

const groups: DemoGroup[] = [
  {
    id: "g-human",
    title: "human ↔ assistant",
    subtitle: "最近：创建 coder",
    appearAt: 0,
  },
  {
    id: "g-coder",
    title: "assistant ↔ coder",
    subtitle: "最近：汇报进度",
    appearAt: 60,
  },
];

const messages: DemoMessage[] = [
  {
    id: "m1",
    from: "human",
    content: "创建一个 coder 代理",
    senderId: humanId,
    contentType: "text",
    sendTime: "10:01",
    appearAt: 120,
  },
  {
    id: "m2",
    from: "assistant",
    content: "已创建 coder，并建立对话",
    senderId: assistantId,
    contentType: "text",
    sendTime: "10:01",
    appearAt: 150,
  },
  {
    id: "m3",
    from: "human",
    content: "让 coder 汇报进度",
    senderId: humanId,
    contentType: "text",
    sendTime: "10:02",
    appearAt: 180,
  },
  {
    id: "m4",
    from: "assistant",
    content: "coder 已回复：任务完成 40%",
    senderId: assistantId,
    contentType: "text",
    sendTime: "10:02",
    appearAt: 210,
  },
];

const nodes: DemoNode[] = [
  { id: "human", label: "human", x: 140, y: 120, appearAt: 0 },
  { id: "assistant", label: "assistant", x: 320, y: 90, appearAt: 0 },
  { id: "coder", label: "coder", x: 420, y: 200, appearAt: 210 },
];

const edges: DemoEdge[] = [
  { id: "e1", from: "human", to: "assistant", appearAt: 0 },
  { id: "e2", from: "assistant", to: "coder", appearAt: 240 },
];

const historyItems: DemoPanelItem[] = [
  { id: "h1", label: "system: 初始化角色与上下文", appearAt: 0 },
  { id: "h2", label: "assistant: 创建 coder 代理", appearAt: 150 },
  { id: "h3", label: "assistant: 汇总 coder 回复", appearAt: 210 },
];

const toolItems: DemoPanelItem[] = [
  { id: "t1", label: "create(role=\"coder\")", appearAt: 150 },
  { id: "t2", label: "send_direct_message()", appearAt: 200 },
];

export function getDemoState(frame: number, fps: number): DemoState {
  const selectedGroupId = frame < 170 ? "g-human" : "g-coder";
  const activeTitle = selectedGroupId === "g-human" ? "human ↔ assistant" : "assistant ↔ coder";

  const contentText =
    frame < 150
      ? "等待用户输入..."
      : frame < 210
        ? "已创建 coder，并建立对话。"
        : "coder 已回复：任务完成 40%。";

  const reasoningText =
    frame < 150
      ? "分析用户意图，准备创建子 agent。"
      : frame < 210
        ? "创建 coder 并建立 P2P 群组。"
        : "汇总 coder 回复并反馈给用户。";

  const agentRoleById = new Map([
    [humanId, "human"],
    [assistantId, "assistant"],
    [coderId, "coder"],
  ]);

  const historyEntries = historyItems.map((item) => ({ id: item.id, role: "assistant", content: item.label }));

  const historyRole = (entry: any) => (typeof entry?.role === "string" ? entry.role : "unknown");
  const historyAccent = (role?: string) => {
    if (!role) return "#94a3b8";
    if (role === "human") return "#f8fafc";
    if (role === "assistant") return "#38bdf8";
    if (role === "productmanager") return "#fb7185";
    if (role === "coder") return "#34d399";
    if (role === "tool") return "#fbbf24";
    if (role === "system") return "#a78bfa";
    return "#94a3b8";
  };
  const summarizeHistoryEntry = (entry: any, index: number) => {
    const contentText = typeof entry?.content === "string" ? entry.content : "";
    return `#${index + 1} — ${contentText}`;
  };

  return {
    workspaceId,
    humanId,
    assistantId,
    activeTitle,
    draft: frame < 120 ? "" : frame < 160 ? "创建一个 coder 代理" : "",
    agentRoleById,
    groups: groups.filter((g) => frame >= g.appearAt),
    selectedGroupId,
    messages: messages.filter((m) => frame >= m.appearAt),
    nodes: nodes.filter((n) => frame >= n.appearAt),
    edges: edges.filter((e) => frame >= e.appearAt),
    historyItems: historyItems.filter((h) => frame >= h.appearAt),
    historyEntries: historyEntries.filter((_, idx) => frame >= historyItems[idx]?.appearAt),
    historyRole,
    historyAccent,
    summarizeHistoryEntry,
    toolItems: toolItems.filter((t) => frame >= t.appearAt),
    contentText,
    reasoningText,
  };
}
