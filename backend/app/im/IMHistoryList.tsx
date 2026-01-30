type IMHistoryListProps = {
  entries: any[];
  historyRole: (entry: any) => string;
  historyAccent: (role?: string) => string;
  summarizeHistoryEntry: (
    entry: any,
    index: number,
    opts?: { omitRole?: boolean }
  ) => string;
};

export function IMHistoryList({
  entries,
  historyRole,
  historyAccent,
  summarizeHistoryEntry,
}: IMHistoryListProps) {
  return (
    <div className="history-list">
      {entries.length === 0 ? (
        <div className="muted">—</div>
      ) : (
        entries.map((entry, idx) => (
          <details
            key={entry?.id ?? `${idx}`}
            className="history-item"
            style={{ ["--accent" as any]: historyAccent(historyRole(entry)) }}
          >
            <summary>
              <span className="history-role">{historyRole(entry)}</span>
              <span className="history-summary">
                {summarizeHistoryEntry(entry, idx, { omitRole: true })}
              </span>
            </summary>
            <div className="history-item-body">
              <pre>{JSON.stringify(entry, null, 2)}</pre>
            </div>
          </details>
        ))
      )}
    </div>
  );
}
