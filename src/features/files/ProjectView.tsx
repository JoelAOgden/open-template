import { ViewHeader } from '../../components/patterns/View';
import { useConfirm } from "../../components/patterns/ConfirmDialog";
import { CodeBlock, Heading, Text } from "../../components/ui/Typography";
import { Dialog, useDialog } from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileCode2,
  Folder,
  FolderOpen,
  Play,
  Square,
  X,
} from "lucide-react";
import type { Run, RunnerState, StartInfo, TreeEntry } from "../../../shared/model";
import { api } from "../../lib/api";

function Tree({
  entries,
  selected,
  choose,
  changed,
}: {
  entries: TreeEntry[];
  selected: string;
  choose: (p: string) => void;
  changed: Set<string>;
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  return (
    <div className="file-tree">
      {entries.map((e) => (
        <div key={e.path}>
          {e.type === "directory" ? (
            <>
              <Button
                className="tree-entry"
                onClick={() =>
                  setClosed((old) => {
                    const next = new Set(old);
                    next.has(e.path) ? next.delete(e.path) : next.add(e.path);
                    return next;
                  })
                }
                aria-expanded={!closed.has(e.path)}
              >
                {closed.has(e.path) ? (
                  <ChevronRight size={12} />
                ) : (
                  <ChevronDown size={12} />
                )}
                {closed.has(e.path) ? (
                  <Folder size={14} />
                ) : (
                  <FolderOpen size={14} />
                )}
                <span>{e.name}</span>
              </Button>
              {!closed.has(e.path) && (
                <div className="tree-indent">
                  <Tree
                    entries={e.children ?? []}
                    selected={selected}
                    choose={choose}
                    changed={changed}
                  />
                </div>
              )}
            </>
          ) : (
            <Button
              className={`tree-entry ${selected === e.path ? "active" : ""}`}
              onClick={() => choose(e.path)}
            >
              <span className="tree-spacer" />
              <FileCode2 size={14} />
              <span>{e.name}</span>
              {changed.has(e.path) && (
                <span
                  className="file-changed"
                  title="Changed in the latest run"
                >
                  M
                </span>
              )}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
export function ProjectExplorer({
  run,
  selected,
  choose,
  refreshKey,
  onError,
}: {
  run: Run | null;
  selected: string;
  choose: (path: string) => void;
  refreshKey: string;
  onError: (message: string) => void;
}) {
  const [tree, setTree] = useState<TreeEntry[]>([]);
  useEffect(() => {
    let active = true,
      pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const entries = await api<TreeEntry[]>("/tree");
        if (active) setTree(entries);
      } catch (e) {
        if (active) onError((e as Error).message);
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refreshKey, onError]);
  return (
    <section className="project-explorer" aria-label="Project files">
      <div className="explorer-scroll">
        {tree.length ? (
          <Tree
            entries={tree}
            selected={selected}
            choose={choose}
            changed={new Set(run?.changedFiles.map((c) => c.path))}
          />
        ) : (
          <Text className="empty-state">No files</Text>
        )}
      </div>
    </section>
  );
}

export function ProjectRunner({
  runner,
  startInfo,
  busy,
  act,
}: {
  runner: RunnerState;
  startInfo: StartInfo;
  busy: boolean;
  act: (route: string, data?: unknown) => Promise<void>;
}) {
  const confirmAction = useConfirm();
  const [outputOpen, setOutputOpen] = useState(false);
  const active = ["starting", "running", "stopping"].includes(runner.status);
  const status = runner.status === "exited" ? "Exited" : runner.status === "error" ? "Failed" : runner.status;
  const showError = () => {
    const exit = runner.exitCode != null ? `Exit code: ${runner.exitCode}` : runner.exitSignal ? `Signal: ${runner.exitSignal}` : "";
    const output = runner.logLines.join("\n").trim();
    void confirmAction(["Project failed to start or exited with an error.", exit, output || startInfo.error || "No error output was captured."].filter(Boolean).join("\n\n"), { title: "Project output", alert: true });
  };
  return (
    <section className="runner-card" aria-label="Run project">
      <div className="runner-buttons">
        <ViewHeader className="runner-heading">
          <Heading level={2}>Run project</Heading>
          {runner.status === "error" ? (
            <Button className="runner-status error runner-error" title="Show error" onClick={showError}>
              <i />Failed
            </Button>
          ) : <span className={`runner-status ${runner.status}`} role="status" title="Process status does not verify correctness">
            <i />{status}
          </span>}
        </ViewHeader>
        <Button
          className="project-launch-button"
          disabled={active ? runner.status === "stopping" : busy || !startInfo.script}
          title={active ? "Stop project" : startInfo.error || `Run ${startInfo.filename ?? "start.sh"} locally with your permissions`}
          onClick={() => void act(active ? "/stop" : "/start", active ? undefined : { scriptHash: startInfo.scriptHash })}
        >
          {active ? <Square size={12} /> : <Play size={13} />}
          {active ? "Stop project" : "Start project"}
        </Button>
        {runner.detectedLocalUrl && runner.status === "running" && (
          <a className="runner-open" href={runner.detectedLocalUrl} target="_blank" rel="noreferrer" aria-label="Open project" title={runner.detectedLocalUrl}>
            <ExternalLink size={14} /><span>{runner.detectedLocalUrl}</span>
          </a>
        )}
        {(active || runner.logLines.length > 0) && (
          <Button className="runner-output-button" onClick={() => setOutputOpen(true)}>View output</Button>
        )}
      </div>
      {outputOpen && <ProjectOutput runner={runner} close={() => setOutputOpen(false)} />}
    </section>
  );
}

function ProjectOutput({ runner, close }: { runner: RunnerState; close: () => void; }) {
  const dialog = useDialog();
  return (
    <Dialog ref={dialog} className="project-output-dialog" aria-labelledby="project-output-title" onClose={close}>
      <ViewHeader className="project-output-heading">
        <Heading level={2} id="project-output-title">Project output</Heading>
        <Button iconOnly aria-label="Close output" onClick={() => dialog.current?.close()} autoFocus><X size={16} /></Button>
      </ViewHeader>
      <div className="project-output-status">
        <span>{runner.status === "error" ? "Failed" : runner.status === "exited" ? "Exited successfully" : runner.status}</span>
        {runner.exitCode != null && <span>Exit code {runner.exitCode}</span>}
        {runner.exitSignal && <span>{runner.exitSignal}</span>}
      </div>
      <CodeBlock tabIndex={0} aria-label="Project output">{runner.logLines.join("\n") || "Waiting for output…"}</CodeBlock>
    </Dialog>
  );
}
