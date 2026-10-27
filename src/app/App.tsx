import { WorkspaceView } from "../components/layout/WorkspaceView";
import { useDesktopGuards } from "./useDesktopGuards";
import { SplitHandle } from "../components/layout/SplitHandle";
import { EditDefinitionDialog, type Modal } from "./EditDefinitionDialog";
import { useWorkspaceState } from "./useWorkspaceState";
import { Tabs, Tab, TabPanel } from '../components/ui/Tabs';
import { useConfirm } from "../components/patterns/ConfirmDialog";
import { CodeBlock, Text } from "../components/ui/Typography";
import { Input } from "../components/ui/Fields";
import { Button } from "../components/ui/Button";
import { ProjectMenu } from "../features/projects/ProjectMenu";
import { hasPlaceholder, sectionTemplates, templateNodes } from "../../shared/section-templates";
import { ProjectsDialog } from "../features/projects/ProjectsDialog";
import { WorkflowPanel } from "../features/pipeline/WorkflowPanel";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Bug,
  Check,
  LoaderCircle,
  Plus,
  Settings2,
  Upload,
  X,
} from "lucide-react";
import type { StudioState, Document, Project } from "../../shared/model";
import { api } from "../lib/api";
import { Editor, type EditorHandle } from "../features/editor/Editor";
import { ProjectExplorer, ProjectRunner } from "../features/files/ProjectView";
import { ChangesView } from "../features/diagnostics/ChangesView";
import { FileView } from "../features/files/FileView";
import { DebugPage } from "../features/diagnostics/DebugPage";
import { SectionTree } from "../features/specification/SectionTree";
import { FileDrop } from "../features/specification/FileDrop";
import { ImportConflict } from "../features/specification/ImportConflict";
import { Settings } from "../features/settings/Settings";
import type { AgentSettings } from "../../shared/agent-settings";
import { useDefinitionImports } from "../features/specification/useDefinitionImports";
import { IMPORT_ACCEPT } from "../../shared/imports";

export function App() {
  const confirmAction = useConfirm();
  const [sectionId, setSectionId] = useState(""),
    [documentId, setDocumentId] = useState("");
  const [view, setView] = useState<"document" | "file">("document"),
    [explorerTab, setExplorerTab] = useState<"sections" | "files">("sections"),
    [workspaceTab, setWorkspaceTab] = useState<"development" | "pipeline">("development"),
    [selectedFile, setSelectedFile] = useState(""),
    [leftWidth, setLeftWidth] = useState(
      () => Number(localStorage.getItem("studio:left")) || 220,
    );
  const [debugOpen, setDebugOpen] = useState(
    () => window.location.hash === "#debug",
  );
  const closeDebug = useCallback(() => {
    window.location.hash = "";
    setDebugOpen(false);
  }, []);
  useEffect(() => {
    const navigate = () => setDebugOpen(window.location.hash === "#debug");
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState<"new" | "open" | null>(null);
  const importState = useRef({ busy: false, epoch: 0 });
  const [applyNotice, setApplyNotice] = useState("");
  const [launching, setLaunching] = useState(false);
  const workflowRequest = useRef(false);
  const [error, setError] = useState(""),
    [saveStatus, setSaveStatus] = useState("All changes saved"),
    [acting, setActing] = useState(false),
    [modal, setModal] = useState<Modal>(null),
    [newName, setNewName] = useState("");
  const editorRef = useRef<EditorHandle>(null);
  const { state, setState, refresh } = useWorkspaceState(importState, setError, () => setWorkspaceTab("pipeline"));
  const act = async <T,>(route: string, data: unknown = {}) => {
    setActing(true);
    setError("");
    setApplyNotice("");
    try {
      const result = await api<T>(route, data);
      await refresh();
      return result;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setActing(false);
    }
  };
  const safeAct = async (route: string, data?: unknown) => {
    try {
      await act(route, data);
    } catch {
      /* displayed above */
    }
  };
  const flush = async () => {
    if (importState.current.busy) return false;
    try {
      await editorRef.current?.flush();
      return true;
    } catch {
      return false;
    }
  };
  useDesktopGuards(saveStatus, flush, setError);
  const { importing, importConflict, importInput, importTarget, performImport, requestImport } = useDefinitionImports(importState, flush, {
    onProject: project => setState(old => old ? { ...old, project } : old),
    onOpen: doc => { setSectionId(doc.sectionId); setDocumentId(doc.id); setView("document"); },
    onError: setError, onBegin: () => setApplyNotice("")
  });
  const saveSettings = async (settings: AgentSettings) => {
    await act("/settings", settings);
  };
  const selectDocument = async (sectionId: string, id: string) => {
    if (!(await flush())) return false;
    setSectionId(sectionId);
    setDocumentId(id);
    setView("document");
    return true;
  };
  const openFile = async (path: string) => {
    if (!(await flush())) return;
    setSelectedFile(path);
    setView("file");
  };
  const section =
    state?.project.sections.find((s) => s.id === sectionId) ??
    state?.project.sections[0];
  const docs =
    state?.project.documents.filter((d) => d.sectionId === section?.id) ?? [];
  const document = docs.find((d) => d.id === documentId) ?? docs[0];
  useEffect(() => {
    setSaveStatus("All changes saved");
  }, [document?.id]);
  const workflowAction = async (route: string, data?: unknown) => {
    if (workflowRequest.current) return;
    workflowRequest.current = true;
    setLaunching(true);
    try {
      if (!(await flush())) throw new Error("Save the document before running.");
      if (route === "/workflows") {
        const fresh = await api<StudioState>("/state");
        const unfinished = fresh.project.documents.filter(hasPlaceholder);
        if (unfinished.length && !await confirmAction(`Unfilled {replace me} placeholders remain in:

${unfinished.map(doc => {
          const section = fresh.project.sections.find(s => s.id === doc.sectionId);
          return `${section?.displayName ?? "Document"} / ${doc.title}`;
        }).join("\n")}

Replace them to give the agent your requirements. Build anyway?`)) return;
      }
      closeDebug();
      setWorkspaceTab("pipeline");
      await act(route, data);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      workflowRequest.current = false;
      setLaunching(false);
    }
  };
  const unfinishedWorkflow = !!state?.workflow && !["accepted", "dismissed"].includes(state.workflow.status);
  const busy = acting || launching || importing || state?.busy === true;
  const displayedSaveStatus = importing ? "Importing…" : saveStatus;
  const refreshKey = `${state?.run?.id}:${state?.run?.status}`;
  const showModal = (value: NonNullable<Modal>) => {
    setApplyNotice("");
    setNewName(value.type === "project" ? (state?.project.name ?? "") : "");
    setModal(value);
  };
  const removeDefinition = async (kind: "section" | "document", id: string) => {
    if (!(await flush())) return;
    setActing(true);
    setError("");
    setApplyNotice("");
    try {
      const fresh = await api<StudioState>("/state");
      const target =
        kind === "section"
          ? fresh.project.sections.find((s) => s.id === id)
          : fresh.project.documents.find((d) => d.id === id);
      if (!target) {
        await refresh();
        return;
      }
      const name = "displayName" in target ? target.displayName : target.title;
      const documents = fresh.project.documents.filter(
        (d) => d.sectionId === id,
      );
      const question =
        kind === "section" && documents.length
          ? `Delete “${name}” and its ${documents.length} ${documents.length === 1 ? "document" : "documents"}?`
          : `Delete “${name}”?`;
      if (!await confirmAction(question)) return;
      const payload =
        "version" in target
          ? { version: target.version }
          : {
            documents: documents.map(({ id, version }) => ({ id, version })),
          };
      const project = await api<Project>(
        `/${kind === "section" ? "sections" : "documents"}/${id}`,
        payload,
        "DELETE",
      );
      setState((old) => (old ? { ...old, project } : old));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActing(false);
    }
  };
  const modalSubmit = async () => {
    if (!newName.trim() || !(await flush())) return;
    try {
      if (modal?.type === "section") {
        const s = await api<{ id: string; }>("/sections", { name: newName });
        setSectionId(s.id);
        setDocumentId("");
      }
      if (modal?.type === "document") {
        const d = await api<Document>("/documents", {
          sectionId: modal.sectionId,
          title: newName,
        });
        setSectionId(d.sectionId);
        setDocumentId(d.id);
      }
      if (modal?.type === "project") await api("/project", { name: newName });
      if (modal?.type === "section" || modal?.type === "document")
        setView("document");
      await refresh();
      setModal(null);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (!state)
    return (
      <div className="app-loading">
        {error ? (
          <Text role="alert">{error}</Text>
        ) : (
          <Text>
            <LoaderCircle size={16} className="spin" /> Loading…
          </Text>
        )}
        {error && <Button onClick={() => void refresh()}>Retry</Button>}
      </div>
    );
  return (
    <div className="studio-app">
      <Input
        ref={importInput}
        type="file"
        aria-label="Import files"
        accept={IMPORT_ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          const target = importTarget.current;
          importTarget.current = null;
          if (target) void performImport(target, files);
        }}
      />
      <header className="topbar">
        <span className="app-name">open-template</span>
        <ProjectMenu name={state.project.name} path={state.workspace?.path} busy={busy} disabled={importing || acting} beforeOpen={flush}
          onNew={() => setProjectsOpen("new")} onOpen={() => setProjectsOpen("open")} onRename={() => showModal({ type: "project" })} />
        <Tabs className="workspace-tabs" role="tablist" aria-label="Workspace" >
          {(["development", "pipeline"] as const).map(tab => <Tab key={tab} id={`${tab}-tab`} role="tab" aria-selected={workspaceTab === tab && !debugOpen} aria-controls={`${tab}-panel`} tabIndex={workspaceTab === tab ? 0 : -1} onClick={() => { closeDebug(); setWorkspaceTab(tab); }}>
            {tab === "development" ? "Development" : "Pipeline"}{tab === "pipeline" && state.workflow?.status === "running" && <span className="activity-dot" aria-label="Running" />}
          </Tab>)}
        </Tabs>
        <div className="header-actions">
          <Button iconOnly aria-label="Settings" title="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={15} />
          </Button>
          {applyNotice && (
            <span className="save-state" role="status">
              {applyNotice}
            </span>
          )}
          <Button
            iconOnly
            aria-label="Debug"
            title="Debug"
            onClick={() => {
              window.location.hash = "debug";
              setDebugOpen(true);
            }}
          >
            <Bug size={15} />
          </Button>
          <span
            className={`save-state ${displayedSaveStatus === "All changes saved" ? "" : "pending"}`}
            role="status"
            aria-label={displayedSaveStatus}
            title={displayedSaveStatus}
          >
            {importing ? (
              <LoaderCircle size={14} className="spin" />
            ) : saveStatus === "All changes saved" ? (
              <Check size={14} />
            ) : (
              saveStatus
            )}
          </span>

          <Button
            variant="primary"
            size="large"
            disabled={busy || unfinishedWorkflow}
            title={unfinishedWorkflow ? "Finish or cancel the current run in Pipeline first." : "Build the project from your saved sections and documents."}
            onClick={() => { void workflowAction("/workflows", { fullSpec: false, source: "project" }).catch(() => { }); }}
          >
            {launching ? "Starting…" : state.appliedSnapshotHash ? "Build changes" : "Build app"}
          </Button>

        </div>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <Button
            aria-label="Dismiss error"
            iconOnly
            onClick={() => setError("")}
          >
            <X size={16} />
          </Button>
        </div>
      )}
      <WorkspaceView
        active={!debugOpen && workspaceTab === "development"}
        labelledBy="development-tab"
        className="workspace development-workspace"
        id="development-panel"
        role="tabpanel"
        aria-labelledby="development-tab"
        inert={importing}
        aria-busy={importing}
        style={
          {
            "--left-width": `${leftWidth}px`,

          } as React.CSSProperties
        }
      >
        <aside className="definitions" aria-label="Explorer">
          <Tabs className="explorer-tabs" role="tablist" aria-label="Explorer views">
            {(["sections", "files"] as const).map(tab => (
              <Tab
                key={tab}
                id={`explorer-${tab}-tab`}
                role="tab"
                aria-selected={explorerTab === tab}
                aria-controls={`explorer-${tab}-panel`}
                tabIndex={explorerTab === tab ? 0 : -1}
                onClick={() => setExplorerTab(tab)}

              >
                {tab === "sections" ? "Specification" : "Project"}
              </Tab>
            ))}
          </Tabs>
          <div className="navigation-panes">
            <TabPanel className="sections-pane" id="explorer-sections-panel" role="tabpanel" aria-labelledby="explorer-sections-tab" hidden={explorerTab !== "sections"}>
              <div className="definitions-scroll">
                <SectionTree
                  project={state.project}
                  selectedSection={section?.id}
                  selectedDocument={document?.id}
                  documentActive={view === "document"}
                  disabled={acting || importing}
                  select={selectDocument}
                  add={(sectionId) =>
                    showModal({ type: "document", sectionId })
                  }
                  remove={(kind, id) => void removeDefinition(kind, id)}
                  importFiles={requestImport}
                  onError={setError}
                />
                <Button
                  className="add-section"
                  aria-label="Add section"
                  title="Add section"
                  onClick={() => showModal({ type: "section" })}
                >
                  <Plus size={15} /> Add section
                </Button>
              </div>
            </TabPanel>
            <TabPanel className="files-pane" id="explorer-files-panel" role="tabpanel" aria-labelledby="explorer-files-tab" hidden={explorerTab !== "files"}>
              <ProjectExplorer
                run={state.run}
                selected={view === "file" ? selectedFile : ""}
                choose={(path) => void openFile(path)}
                refreshKey={refreshKey}
                onError={setError}
              />
            </TabPanel>
          </div>
          <div className="explorer-runner">
            <ProjectRunner
              runner={state.runner}
              startInfo={state.startInfo}
              busy={busy}
              act={safeAct}
            />
          </div>
        </aside>
        <SplitHandle label="Resize explorer" value={leftWidth} onChange={value => { setLeftWidth(value); localStorage.setItem("studio:left", String(value)); }} className="resize-handle left-resize" />
        <section className="editor-region" aria-label="Workspace editor">
          <FileDrop
            className="workspace-view editor-scroll"
            aria-label="Definition editor"
            hidden={view !== "document"}
            disabled={importing || !section}
            onFiles={(files) => {
              if (document)
                requestImport({ kind: "document", id: document.id }, files);
              else if (section)
                requestImport({ kind: "section", id: section.id }, files);
            }}
            onError={setError}
          >
            {document && section ? (
              <Editor
                key={document.id}
                ref={editorRef}
                document={document}
                onSaved={() => void refresh()}
                onError={setError}
                onImage={() =>
                  requestImport(
                    { kind: "document", id: document.id },
                    undefined,
                    true,
                  )
                }
                onStatus={(status) => {
                  setSaveStatus(status);
                  if (status !== "All changes saved") setApplyNotice("");
                }}
                actions={
                  <>
                    {!document.nodes.length && sectionTemplates[section.slug] && <Button variant="quiet" disabled={busy} onClick={() => {
                      void (async () => {
                        if (!await flush()) return;
                        try {
                          await api(`/documents/${document.id}`, { ...document, nodes: templateNodes(section.slug, () => crypto.randomUUID()) }, "PUT");
                          await refresh();
                        } catch (e) { setError((e as Error).message); }
                      })();
                    }}>Use template</Button>}
                    <Button
                      iconOnly
                      title="Import files"
                      aria-label="Import into this document"
                      onClick={() =>
                        requestImport({ kind: "document", id: document.id })
                      }
                    >
                      <Upload size={15} />
                    </Button>
                    <Button
                      iconOnly
                      title={`${section.displayName} skill`}
                      aria-label={`${section.displayName} skill`}
                      onClick={() =>
                        void api<{ text: string; }>(`/skills/${section.slug}`)
                          .then((r) =>
                            showModal({
                              type: "skill",
                              text: r.text,
                              title: `${section.displayName} skill`,
                            }),
                          )
                          .catch((e) => setError((e as Error).message))
                      }
                    >
                      <BookOpen size={15} />
                    </Button>
                  </>
                }
              />
            ) : (
              <div className="empty-editor">
                <Button
                  variant="quiet"
                  onClick={() =>
                    showModal(
                      section
                        ? { type: "document", sectionId: section.id }
                        : { type: "section" },
                    )
                  }
                >
                  <Plus size={14} />
                  {section ? "Add document" : "Add section"}
                </Button>
              </div>
            )}
          </FileDrop>
          <div
            className="workspace-view file-workspace"
            hidden={view !== "file"}
          >
            {view === "file" && selectedFile && (
              <FileView
                key={selectedFile}
                path={selectedFile}
                refreshKey={refreshKey}
              />
            )}
          </div>
        </section>
      </WorkspaceView>
      <WorkspaceView active={!debugOpen && workspaceTab === "pipeline"} labelledBy="pipeline-tab" className="pipeline-workspace" id="pipeline-panel" role="tabpanel" aria-labelledby="pipeline-tab">
        <WorkflowPanel current={state.workflow} savedDraft={!!state.checkpoint} disabled={acting || launching || importing} act={workflowAction} />
        {(state.session || state.run) && <details className="legacy-history"><summary>Earlier history</summary>
          {state.session?.revisions.map(revision => <details key={revision.id}><summary>{new Date(revision.createdAt).toLocaleString()} · {revision.summary}</summary><CodeBlock>{JSON.stringify(revision, null, 2)}</CodeBlock></details>)}
          <ChangesView run={state.run} />
        </details>}
      </WorkspaceView>
      {projectsOpen && <ProjectsDialog initialMode={projectsOpen} onClose={() => setProjectsOpen(null)} beforeOpen={flush} busy={busy} />}
      {debugOpen && (
        <DebugPage
          onClose={closeDebug}
          hasSession={!!state.session}
          refreshKey={`${state.project.name}:${state.project.sections.map((s) => s.id + s.displayName).join()}:${state.project.documents.map((d) => d.id + d.version).join()}:${state.session?.currentRevision}:${state.session?.status}:${state.run?.id}:${state.run?.status}:${state.appliedSnapshotHash}`}
        />
      )}
      {modal && <EditDefinitionDialog modal={modal} newName={newName} onName={setNewName} onClose={() => setModal(null)} onSubmit={modalSubmit} />}
      {importConflict && <ImportConflict key={importConflict.index} {...importConflict} />}
      {settingsOpen && <Settings settings={state.settings} busy={busy}
        onSave={saveSettings} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
