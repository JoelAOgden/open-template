import { Text } from "../../components/ui/Typography";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type Source = { text: string | null; binary: boolean; size: number; };

export function FileView({
  path,
  refreshKey,
}: {
  path: string;
  refreshKey: string;
}) {
  const [file, setFile] = useState<Source | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true,
      pending = false;
    setFile(null);
    setError("");
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const source = await api<Source>(
          `/file?path=${encodeURIComponent(path)}`,
        );
        if (active) {
          setFile(source);
          setError("");
        }
      } catch (e) {
        if (active) {
          setFile(null);
          setError((e as Error).message);
        }
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
  }, [path, refreshKey]);

  return (
    <section className="source-view" aria-label={`File ${path}`}>
      <div className="code-caption">
        <span>{path}</span>
        <span>Read only</span>
      </div>
      {error ? (
        <Text role="alert">{error}</Text>
      ) : !file ? (
        <Text className="muted">Loading…</Text>
      ) : file.binary ? (
        <Text className="muted">
          Binary file · {file.size.toLocaleString()} bytes
        </Text>
      ) : (
        <div
          className="code-lines"
          aria-label={`Source of ${path}`}
          tabIndex={0}
        >
          {file.text?.split("\n").map((line, i) => (
            <div className="code-line" key={i}>
              <span className="line-number" aria-hidden="true">
                {i + 1}
              </span>
              <code>{line || " "}</code>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
