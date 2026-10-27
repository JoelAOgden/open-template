import { Toolbar } from '../../components/patterns/View';
import { CodeBlock, Heading, Text } from "../../components/ui/Typography";
import { Button } from "../../components/ui/Button";
import { Select, Option } from "../../components/ui/Select";
import { useEffect, useState } from "react";
import type { DebugFile, DebugFileIndex } from "../../../shared/model";
import { api } from "../../lib/api";
import { Asset } from "../editor/EditorBlocks";

export function DebugFiles({
  hasSession,
  refreshKey,
}: {
  hasSession: boolean;
  refreshKey: string;
}) {
  const [scope, setScope] = useState("current");
  const [index, setIndex] = useState<DebugFileIndex | null>(null);
  const [selected, setSelected] = useState("AGENTS.md");
  const [loaded, setLoaded] = useState<{
    file: DebugFile;
    scope: string;
    index: DebugFileIndex;
  } | null>(null);
  const [error, setError] = useState("");
  const effectiveScope = hasSession ? scope : "current";
  const file =
    loaded?.scope === effectiveScope &&
      loaded.index === index &&
      loaded.file.path === selected
      ? loaded.file
      : null;
  useEffect(() => {
    let active = true;
    setIndex(null);
    setError("");
    api<DebugFileIndex>(`/debug/files?scope=${effectiveScope}`)
      .then((result) => {
        if (active) {
          setIndex(result);
          setSelected((current) =>
            result.files.some((file) => file.path === current)
              ? current
              : "AGENTS.md",
          );
        }
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, [effectiveScope, refreshKey]);
  useEffect(() => {
    let active = true;
    setLoaded(null);
    if (index)
      api<DebugFile>(
        `/debug/file?scope=${effectiveScope}&path=${encodeURIComponent(selected)}`,
      )
        .then((result) => {
          if (active) {
            setLoaded({ file: result, scope: effectiveScope, index });
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError((e as Error).message);
        });
    return () => {
      active = false;
    };
  }, [index, selected, effectiveScope]);
  return (
    <section className="debug-files" aria-label="Server files">
      <Toolbar className="debug-toolbar">
        <Select variant="compact"
          aria-label="File context"
          value={effectiveScope}
          onChange={(event) => setScope(event.target.value)}
        >
          <Option value="current">Current spec</Option>
          {hasSession && <Option value="plan">Plan snapshot</Option>}
        </Select>
        <span className="debug-note">
          Project files are current. References are read-only.
        </span>
      </Toolbar>
      {error && <Text role="alert">{error}</Text>}
      <div className="debug-file-layout">
        <nav aria-label="Reference files">
          {index
            ? index.files.map((item) => (
              <Button
                key={item.path}
                title={item.path}
                aria-current={selected === item.path ? "page" : undefined}
                onClick={() => setSelected(item.path)}
              >
                {item.path}
              </Button>
            ))
            : !error && <Text>Loading…</Text>}
        </nav>
        <div className="debug-file-view">
          <Heading level={2}>{selected}</Heading>
          {file ? (
            <>
              {file.assetId && <Asset id={file.assetId} alt={file.path} />}
              {file.text !== null ? (
                <CodeBlock aria-label="File contents" tabIndex={0}>
                  {file.text}
                </CodeBlock>
              ) : (
                !file.assetId && (
                  <Text>Binary file · {file.size.toLocaleString()} bytes</Text>
                )
              )}
            </>
          ) : (
            !error && <Text>Loading…</Text>
          )}
        </div>
      </div>
    </section>
  );
}
