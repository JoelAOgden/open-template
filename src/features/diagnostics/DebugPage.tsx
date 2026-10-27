import { ViewHeader, Toolbar } from '../../components/patterns/View';
import { CodeBlock, Heading, Text } from "../../components/ui/Typography";
import { Button } from "../../components/ui/Button";
import { Select, Option } from "../../components/ui/Select";
import { providerLabel } from "../../../shared/agent-settings";
import { WorkflowPanel } from "../pipeline/WorkflowPanel";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Copy } from "lucide-react";
import type { PromptInfo, PromptRecord } from "../../../shared/model";
import { api } from "../../lib/api";
import { DebugFiles } from "./DebugFiles";
import { PipelineHistory } from "./PipelineHistory";

const names = {
  analysis: "Analysis",
  plan: "Plan",
  discussion: "Discussion",
  execution: "Execution",
};

export function DebugPage({
  onClose,
  hasSession,
  refreshKey,
}: {
  onClose: () => void;
  hasSession: boolean;
  refreshKey: string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [section, setSection] = useState<"prompts" | "files" | "pipeline" | "workflow">("workflow");
  const [history, setHistory] = useState<PromptInfo[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [record, setRecord] = useState<PromptRecord | null>(null);
  const [view, setView] = useState<"prompt" | "schema">("prompt");
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [copied, setCopied] = useState(false);
  const selected =
    history?.find((item) => item.id === selectedId) ?? history?.[0];
  const current = record?.id === selected?.id ? record : null;
  const content = current
    ? view === "prompt"
      ? current.prompt
      : JSON.stringify(current.responseSchema, null, 2)
    : "";

  useEffect(() => {
    const previousFocus = document.activeElement;
    heading.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    let active = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await api<PromptInfo[]>("/prompts");
        if (active) {
          setHistory(result);
          setHistoryError("");
        }
      } catch (e) {
        if (active) setHistoryError((e as Error).message);
      } finally {
        pending = false;
      }
    };
    void refresh();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setRecord(null);
    setError("");
    if (selected?.id) {
      void api<PromptRecord>(`/prompts/${selected.id}`)
        .then((result) => {
          if (active) setRecord(result);
        })
        .catch((e) => {
          if (active) setError((e as Error).message);
        });
    }
    return () => {
      active = false;
    };
  }, [selected?.id]);

  useEffect(() => {
    setCopied(false);
  }, [content]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setError("");
    } catch {
      setError("Could not copy. Select the text to copy it manually.");
    }
  };

  return (
    <main className="debug-page" aria-label="Debug">
      <div className="debug-shell">
        <ViewHeader className="debug-heading">
          <Button
            iconOnly
            aria-label="Back to workspace"
            onClick={onClose}
          >
            <ArrowLeft size={18} />
          </Button>
          <Heading level={1} ref={heading} tabIndex={-1}>
            Debug
          </Heading>
          <nav className="debug-views" aria-label="Debug sections">
            <Button aria-pressed={section === "workflow"} onClick={() => setSection("workflow")}>Live workflow</Button>
            <Button aria-pressed={section === "pipeline"} onClick={() => setSection("pipeline")}>Pipeline history</Button>
            <Button
              aria-pressed={section === "prompts"}
              onClick={() => setSection("prompts")}
            >
              Prompts
            </Button>
            <Button
              aria-pressed={section === "files"}
              onClick={() => setSection("files")}
            >
              Files
            </Button>
          </nav>
        </ViewHeader>
        <section
          className="debug-prompts"
          aria-label="Prompts"
          hidden={section !== "prompts"}
        >
          <Text className="debug-note">
            Studio prompts only. CLI-internal messages aren’t exposed.
          </Text>
          {(historyError || error) && (
            <Text role="alert">{historyError || error}</Text>
          )}
          {history === null ? (
            !historyError && <Text role="status">Loading…</Text>
          ) : !history.length ? (
            <Text>No prompts recorded yet.</Text>
          ) : (
            <>
              <Select
                aria-label="Prompt history"
                value={selected?.id ?? ""}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {history.map((item, index) => (
                  <Option key={item.id} value={item.id}>
                    {history.length - index} · {names[item.kind]} ·{" "}
                    {new Date(item.createdAt).toLocaleString()}
                  </Option>
                ))}
              </Select>
              <Toolbar className="debug-toolbar">
                {current?.settings && <span className="settings-note" aria-label="Request model and reasoning">
                  {providerLabel(current.settings.provider)} · {current.settings.model ?? "Default model"} · {current.settings.reasoning ?? "Default reasoning"}
                </span>}
                <div className="debug-views" aria-label="Prompt content">
                  <Button
                    aria-pressed={view === "prompt"}
                    onClick={() => setView("prompt")}
                  >
                    Prompt
                  </Button>
                  <Button
                    aria-pressed={view === "schema"}
                    onClick={() => setView("schema")}
                  >
                    Schema
                  </Button>
                </div>
                <Button
                  iconOnly
                  disabled={!current}
                  title={copied ? "Copied" : `Copy ${view}`}
                  aria-label={copied ? "Copied" : `Copy ${view}`}
                  onClick={() => void copy()}
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                </Button>
              </Toolbar>
              {current ? (
                <CodeBlock
                  className="debug-content"
                  aria-label={
                    view === "prompt" ? "Prompt text" : "Response schema"
                  }
                  tabIndex={0}
                >
                  {content}
                </CodeBlock>
              ) : (
                !error && <Text role="status">Loading…</Text>
              )}
            </>
          )}
        </section>
        {section === "files" && (
          <DebugFiles hasSession={hasSession} refreshKey={refreshKey} />
        )}
        {section === "pipeline" && <PipelineHistory />}
        {section === "workflow" && <div className="panel-scroll"><WorkflowPanel /></div>}

      </div>
    </main>
  );
}
