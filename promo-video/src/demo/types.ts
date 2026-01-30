export type DemoGroup = {
  id: string;
  title: string;
  subtitle: string;
  appearAt: number;
};

export type DemoMessage = {
  id: string;
  from: string;
  content: string;
  appearAt: number;
  senderId: string;
  contentType: string;
  sendTime: string;
};

export type DemoNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  appearAt: number;
};

export type DemoEdge = {
  id: string;
  from: string;
  to: string;
  appearAt: number;
};

export type DemoEdgePulse = {
  id: string;
  from: string;
  to: string;
  start: number;
  end: number;
};

export type DemoNodeStatus = {
  id: string;
  start: number;
  end: number;
};

export type DemoPanelItem = {
  id: string;
  label: string;
  appearAt: number;
};

export type DemoState = {
  workspaceId: string;
  humanId: string;
  assistantId: string;
  activeTitle: string;
  draft: string;
  agentRoleById: Map<string, string>;
  groups: DemoGroup[];
  selectedGroupId: string;
  messages: DemoMessage[];
  nodes: DemoNode[];
  edges: DemoEdge[];
  graphNodes: DemoNode[];
  graphEdges: DemoEdge[];
  edgePulses: DemoEdgePulse[];
  nodeStatusTimeline: DemoNodeStatus[];
  sequenceStart: number;
  historyItems: DemoPanelItem[];
  historyEntries: any[];
  historyRole: (entry: any) => string;
  historyAccent: (role?: string) => string;
  summarizeHistoryEntry: (entry: any, idx: number, opts?: { omitRole?: boolean }) => string;
  toolItems: DemoPanelItem[];
  toolTimeline: DemoPanelItem[];
  contentText: string;
  reasoningText: string;
};
