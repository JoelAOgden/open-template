import { useState, useRef, useEffect } from "react";
import type { Document } from "../../../shared/model";
import { api } from "../../lib/api";
export function useDocumentDraft(document: Document, { onSaved, onError, onStatus }: { onSaved: () => void; onError: (s: string) => void; onStatus: (s: string) => void ;}) {
  const [doc, setDoc] = useState(document);
  const current = useRef(doc),
    dirty = useRef(false),
    saving = useRef<Promise<void> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (
      !dirty.current &&
      !saving.current &&
      document.version > current.current.version
    ) {
      current.current = document;
      setDoc(document);
    }
  }, [document]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flush = async (): Promise<void> => {
    clearTimeout(timer.current);
    if (saving.current) {
      await saving.current;
      if (dirty.current) return flush();
      return;
    }
    if (!dirty.current) return;
    const sent = current.current;
    dirty.current = false;
    onStatus("Saving…");
    saving.current = api<Document>(`/documents/${sent.id}`, sent, "PUT")
      .then((saved) => {
        current.current = { ...current.current, version: saved.version };
        setDoc(current.current);
        onStatus(dirty.current ? "Unsaved changes" : "All changes saved");
        onSaved();
      })
      .catch((e) => {
        dirty.current = true;
        onStatus("Save failed");
        onError((e as Error).message);
        throw e;
      })
      .finally(() => {
        saving.current = null;
      });
    await saving.current;
    if (dirty.current) return flush();
  };
  const update = (next: Document) => {
    current.current = next;
    dirty.current = true;
    setDoc(next);
    onStatus("Unsaved changes");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush().catch(() => { });
    }, 650);
  };
  return { doc, current, flush, update };
}
