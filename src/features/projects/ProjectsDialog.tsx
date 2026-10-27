import { Field } from '../../components/ui/Field';
import { ViewHeader, Actions } from '../../components/patterns/View';
import { Heading, Text } from "../../components/ui/Typography";
import { Input, Label } from "../../components/ui/Fields";
import { Dialog, useDialog } from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { useEffect, useState } from "react";
import { FolderOpen, Plus, X } from "lucide-react";
import { api } from "../../lib/api";
export type ProjectList = { current: { path: string; name: string ;} | null; recent: { path: string; name: string; openedAt: string ;}[]; notice?: string ;};
export function ProjectsDialog({ onClose, beforeOpen, busy, initialMode = "new" }: { initialMode?: "new" | "open"; onClose: () => void; beforeOpen: () => Promise<boolean>; busy: boolean ;}) {
  const dialog = useDialog(), [pending, setPending] = useState(false);
  return <Dialog ref={dialog} className="projects-dialog" aria-label="Projects" onCancel={event => { if (pending) event.preventDefault(); else onClose(); }}><ProjectChooser onPending={setPending} onClose={onClose} beforeOpen={beforeOpen} busy={busy} initialMode={initialMode} /></Dialog>;
}
export function ProjectChooser({ onPending, onClose, beforeOpen = async () => true, busy = false, initialMode = "new" }: { onPending?: (pending: boolean) => void; onClose?: () => void; beforeOpen?: () => Promise<boolean>; busy?: boolean; initialMode?: "new" | "open" }) {
  const [projects, setProjects] = useState<ProjectList | null>(null), [folder, setFolder] = useState(""), [pending, setPending] = useState(false), [error, setError] = useState("");
  useEffect(() => { onPending?.(pending); }, [pending, onPending]);
  const [mode, setMode] = useState<"new" | "open">(initialMode), [name, setName] = useState("");
  useEffect(() => { void api<ProjectList>("/projects").then(setProjects).catch(e => setError(e.message)); }, []);
  const target = mode === "new" ? `${folder.trim().replace(/[\\/]+$/, "")}/${name.trim()}` : folder.trim();
  const open = async (path: string, create = false) => {
    if (pending || busy) return; setPending(true); setError("");
    try {
      if (create && (!name.trim() || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /^\./.test(name.trim()) || /[. ]$/.test(name))) throw new Error("Use a project name without slashes, special characters or a trailing dot or space.");
      if (!await beforeOpen()) throw new Error("Save the open document before switching projects.");
      await api(create ? "/projects/new" : "/projects/open", { path }); window.location.reload();
    } catch (e) { setError((e as Error).message); setPending(false); }
  };
  const browse = async () => { setPending(true); setError(""); try { const result = await api<{ path: string | null ;}>("/projects/pick", {}); if (result.path) setFolder(result.path); } catch (e) { setError((e as Error).message); } finally { setPending(false); } };
  return <>
    <ViewHeader className="project-dialog-heading"><Heading level={2}>{mode === "new" ? "Create new project" : "Open project"}</Heading>{onClose && <Button iconOnly aria-label="Close projects" disabled={pending} onClick={onClose}><X size={16} /></Button>}</ViewHeader>
    <div className="project-mode" role="group" aria-label="Project action">
      <Button aria-pressed={mode === "new"} disabled={pending} onClick={() => { setMode("new"); setFolder(""); setError(""); }}><Plus size={14} />New project</Button>
      <Button aria-pressed={mode === "open"} disabled={pending} onClick={() => { setMode("open"); setFolder(""); setError(""); }}><FolderOpen size={14} />Open existing</Button>
    </div>
    <Text>{mode === "new" ? "A new folder for your documents and code." : "Pick a folder to continue working on a project."}</Text>
    {projects?.notice && <Text>{projects.notice}</Text>}
    {busy && <Text role="status">Stop the current pipeline or launch before switching projects.</Text>}
    {error && <Text role="alert">{error}</Text>}
    <form onSubmit={e => { e.preventDefault(); void open(target, mode === "new"); }}>
      {mode === "new" && <Field label="Project name">
        <Input autoFocus aria-label="Project name" value={name} maxLength={80} placeholder="My project" disabled={pending} onChange={e => setName(e.target.value)} /></Field>}
      <Label htmlFor="project-folder">{mode === "new" ? "Save location" : "Project folder"}</Label>
      <div className="folder-field"><Input id="project-folder" aria-label="Project folder path" value={folder} placeholder={mode === "new" ? "/path/to/projects" : "/path/to/my-project"} disabled={pending} onChange={e => setFolder(e.target.value)} /><Button type="button" disabled={pending || busy} onClick={() => void browse()}>Choose…</Button></div>
      {mode === "new" && folder.trim() && name.trim() && <Text className="project-destination">{target}</Text>}
      <Actions className="actions"><Button type="submit" variant="primary" disabled={pending || busy || !folder.trim() || (mode === "new" && !name.trim())}>{pending ? "Please wait…" : mode === "new" ? "Create project" : "Open project"}</Button></Actions>
    </form>
    {!!projects?.recent.length && <div className="recent-projects-section"><Heading level={3}>Recent projects</Heading><ul className="recent-projects">{projects.recent.map(project => <li key={project.path}><Button disabled={pending || busy || project.path === projects.current?.path} onClick={() => void open(project.path)}><strong>{project.name}{project.path === projects.current?.path && <small>Current</small>}</strong><span>{project.path}</span></Button></li>)}</ul></div>}
  </>;
}
