import { useRef, useState, type RefObject } from 'react';
import type { Document, Project, StudioState } from '../../../shared/model';
import { IMAGE_ACCEPT, IMPORT_ACCEPT, importNameKey, type ImportTarget, type ImportResult, type ImportResolution } from '../../../shared/imports';
import { api } from '../../lib/api';
import { readImportFiles } from './imports';
export function useDefinitionImports(importState: RefObject<{ busy: boolean; epoch: number ;}>, flush: () => Promise<boolean>, { onProject, onOpen, onError, onBegin }: { onProject: (project: Project) => void; onOpen: (doc: Document) => void; onError: (message: string) => void; onBegin: () => void ;}) {
  const [importing, setImporting] = useState(false);
  const [importConflict, setImportConflict] = useState<{
    index: number;
    name: string;
    matches: Document[];
    choose: (resolution: ImportResolution | null) => void;
  } | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const importTarget = useRef<ImportTarget | null>(null);
  const performImport = async (target: ImportTarget, files: File[]) => {
    if (!files.length || importState.current.busy || !(await flush())) return;
    if (importState.current.busy) return;
    importState.current.busy = true;
    importState.current.epoch++;
    setImporting(true);
    onError("");
    onBegin();
    try {
      const prepared = await readImportFiles(files);
      const fresh = await api<StudioState>("/state");
      const targetDoc = fresh.project.documents.find(
        (doc) => doc.id === target.id,
      );
      if (target.kind === "document" && !targetDoc)
        throw new Error("Document not found.");
      if (target.kind === "section") {
        for (const [index, file] of prepared.entries()) {
          const matches = fresh.project.documents.filter(
            (doc) => doc.sectionId === target.id &&
              importNameKey(doc.title) === importNameKey(file.name),
          );
          if (!matches.length) continue;
          const resolution = await new Promise<ImportResolution | null>((resolve) => {
            setImportConflict({
              index,
              name: file.name,
              matches,
              choose: (choice) => {
                setImportConflict(null);
                resolve(choice);
              },
            });
          });
          if (!resolution) return;
          file.resolution = resolution;
        }
      }
      const result = await api<ImportResult>("/definition-import", {
        target:
          target.kind === "document"
            ? { ...target, version: targetDoc!.version }
            : target,
        files: prepared,
      });
      onProject(result.project);
      if (result.documents[0]) onOpen(result.documents[0]);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      importState.current.busy = false;
      setImporting(false);
    }
  };
  const requestImport = (
    target: ImportTarget,
    files?: File[],
    imagesOnly = false,
  ) => {
    if (importState.current.busy) return;
    if (files) {
      void performImport(target, files);
      return;
    }
    importTarget.current = target;
    if (importInput.current) {
      importInput.current.accept = imagesOnly ? IMAGE_ACCEPT : IMPORT_ACCEPT;
      importInput.current.click();
    }
  };
  return { importing, importConflict, importInput, importTarget, performImport, requestImport };
}
