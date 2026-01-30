import type { ReactNode } from "react";

type Message = {
  id: string;
  senderId: string;
  content: string;
  contentType: string;
  sendTime: string;
};

type IMMessageListProps = {
  messages: Message[];
  humanAgentId?: string | null;
  agentRoleById: Map<string, string>;
  fmtTime: (iso: string) => string;
  renderContent: (content: string) => ReactNode;
  cx: (...classes: Array<string | false | undefined | null>) => string;
};

export function IMMessageList({
  messages,
  humanAgentId,
  agentRoleById,
  fmtTime,
  renderContent,
  cx,
}: IMMessageListProps) {
  return (
    <>
      {messages.map((m) => {
        const isMe = m.senderId === humanAgentId;
        const senderRole = agentRoleById.get(m.senderId) ?? (isMe ? "human" : m.senderId.slice(0, 8));
        return (
          <div
            key={m.id}
            style={{
              display: "flex",
              justifyContent: isMe ? "flex-end" : "flex-start",
              marginBottom: 10,
            }}
          >
            <div className={cx("bubble", isMe ? "me" : "other")}>
              <div className="bubble-meta">
                {fmtTime(m.sendTime)} • {senderRole}
              </div>
              {renderContent(m.content)}
            </div>
          </div>
        );
      })}
    </>
  );
}
