import { CodeBlock, Text } from "../../components/ui/Typography";
import { Button } from "../../components/ui/Button";
import { useEffect, useState } from "react";
import type { Run, RunInfo } from "../../../shared/model";
import { api } from "../../lib/api";
const runLabel = (run: Pick<Run, "status">) => ({
  running: "Previously running", review: "Review", blocked: "Needs input", paused: "Paused",
  error: "Failed", imported: "Accepted", dismissed: "Dismissed",
})[run.status];
function RunResult({ run }: { run: Run; }) {
  const [active, setActive] = useState(run.changedFiles[0]?.path ?? "");
  const change = run.changedFiles.find(c => c.path === active);
  return (<section className="run-review">
    <Text className="settings-note">Saved history · read-only</Text>
    {run.summary && <Text>{run.summary}</Text>}
    {run.error && <Text className="notice warning">{run.error}</Text>}
    {run.startup && <details className="agent-logs"><summary>Recorded Start check: {run.startup.status}</summary><CodeBlock>{run.startup.logs.join("\n")}</CodeBlock></details>}
    <details className="agent-logs"><summary>Saved run details</summary><CodeBlock>{JSON.stringify(run, null, 2)}</CodeBlock></details>
    {run.changedFiles.length > 0 && (
      <>
        <div className="change-files">
          {run.changedFiles.map((c) => (
            <div
              key={c.path}
              className={`change-row ${active === c.path ? "active" : ""}`}
            >
              <Button onClick={() => setActive(c.path)}>
                <span className={`change-tag ${c.kind}`}>
                  {c.kind === "added"
                    ? "A"
                    : c.kind === "deleted"
                      ? "D"
                      : "M"}
                </span>
                <span>{c.path}</span>
              </Button>
            </div>
          ))}
        </div>
        {change && (
          <div className="diff-view" aria-label={`Diff for ${change.path}`}>
            <div className="code-caption">
              {change.path}
              {change.binary && <span>Binary</span>}
            </div>
            <CodeBlock>
              {change.diff.split("\n").map((line, i) => (
                <div
                  key={i}
                  className={
                    line.startsWith("+")
                      ? "diff-add"
                      : line.startsWith("-")
                        ? "diff-delete"
                        : "diff-context"
                  }
                >
                  {line || " "}
                </div>
              ))}
            </CodeBlock>
          </div>
        )}
      </>
    )}
    {run.logs.length > 0 && (
      <details open={run.status === "running"} className="agent-logs">
        <summary>Activity</summary>
        <CodeBlock>{run.logs.join("\n")}</CodeBlock>
      </details>
    )}
  </section>
  );
}
export function ChangesView({ run }: { run: Run | null; }) {
  const [history, setHistory] = useState<RunInfo[]>([]);
  const [selectedId, setSelectedId] = useState(run?.id ?? "");
  const [savedRun, setSavedRun] = useState<Run | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    setHistoryError("");
    void api<RunInfo[]>("/runs")
      .then((items) => {
        if (!active) return;
        setHistory(items);
        setSelectedId((id) => id || items[0]?.id || "");
        setLoaded(true);
      })
      .catch((e) => {
        if (active) {
          setHistoryError(e.message);
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [run?.id, run?.status]);
  useEffect(() => {
    if (run?.id) setSelectedId(run.id);
  }, [run?.id]);
  useEffect(() => {
    let active = true;
    setDetailError("");
    setSavedRun(null);
    if (selectedId && selectedId !== run?.id) {
      void api<Run>(`/runs/${selectedId}`)
        .then((item) => {
          if (active) setSavedRun(item);
        })
        .catch((e) => {
          if (active) setDetailError(e.message);
        });
    }
    return () => {
      active = false;
    };
  }, [selectedId, run?.id]);
  const error = historyError || detailError;
  const current =
    selectedId === run?.id
      ? run
      : savedRun?.id === selectedId
        ? savedRun
        : null;
  const items = run
    ? [
      {
        id: run.id,
        createdAt: run.createdAt,
        status: run.status,
        summary: run.summary,
        fileCount: run.changedFiles.length,
      },
      ...history.filter((item) => item.id !== run.id),
    ]
    : history;
  return (
    <div className="changes-panel">
      {items.length > 0 && (
        <nav className="change-history" aria-label="Change history">
          {items.map((item) => (
            <Button
              key={item.id}
              className={selectedId === item.id ? "active" : ""}
              aria-pressed={selectedId === item.id}
              data-run-id={item.id}
              title={item.summary}
              onClick={() => setSelectedId(item.id)}
            >
              <time
                dateTime={item.createdAt}
                title={new Date(item.createdAt).toLocaleString()}
              >
                {new Date(item.createdAt).toLocaleString(undefined, {
                  dateStyle: "short",
                  timeStyle: "medium",
                })}
              </time>
              <span>
                {item.fileCount} {item.fileCount === 1 ? "file" : "files"} ·{" "}
                {runLabel(item)}
              </span>
            </Button>
          ))}
        </nav>
      )}
      <div className="project-panel panel-scroll">
        {error && (
          <Text className="notice warning" role="alert">
            {error}
          </Text>
        )}
        {!error && !items.length && (
          <Text className="empty-state">
            {loaded ? "No changes yet." : "Loading…"}
          </Text>
        )}
        {!error && selectedId && !current && (
          <Text className="empty-state">Loading…</Text>
        )}
        {current && (
          <RunResult key={current.id} run={current} />
        )}
      </div>
    </div>
  );
}
