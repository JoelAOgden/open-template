import { Menu } from "../../components/ui/Menu";
import { Text } from "../../components/ui/Typography";
import { Button } from "../../components/ui/Button";
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FolderOpen, Pencil, Plus } from 'lucide-react';
import { api } from '../../lib/api';
type Recent = { path: string; name: string ;};
export function ProjectMenu({ name, path, busy, disabled, beforeOpen, onNew, onOpen, onRename }: {
  name: string; path?: string; busy: boolean; disabled: boolean; beforeOpen: () => Promise<boolean>;
  onNew: () => void; onOpen: () => void; onRename: () => void;
}) {
  const [open, setOpen] = useState(false), [recent, setRecent] = useState<Recent[]>([]), [pending, setPending] = useState(false), [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true; setError('');
    void api<{ recent: Recent[] ;}>('/projects').then(result => { if (alive) setRecent(result.recent); }).catch(e => { if (alive) setError(e.message); });
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => { alive = false; };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => { if (!root.current?.contains(event.target as Node) && !pending) setOpen(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, [open, pending]);
  const choose = (action: () => void) => { setOpen(false); action(); };
  const switchProject = async (target: string) => {
    if (busy || pending) return; setPending(true); setError('');
    try { if (!await beforeOpen()) throw new Error('Save the open document before switching projects.'); await api('/projects/open', { path: target }); window.location.reload(); }
    catch (e) { setPending(false); setError((e as Error).message); }
  };
  return <div ref={root} className="project-switcher" onKeyDown={event => {
    if (event.key === 'Escape' && open && !pending) { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
  }}>
    <Button ref={trigger} className="project-name" aria-label="Project menu" title={path} aria-haspopup="menu" aria-expanded={open} disabled={disabled || pending} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}>
      <span>{name}</span><ChevronDown size={14} />
    </Button>
    {open && <div className="project-dropdown">
      <Menu ref={menu} aria-label="Project actions">
        <Button role="menuitem" disabled={busy || pending} onClick={() => choose(onNew)}><Plus size={15} />New project</Button>
        <Button role="menuitem" disabled={busy || pending} onClick={() => choose(onOpen)}><FolderOpen size={15} />Open existing</Button>
        <Button role="menuitem" disabled={pending} onClick={() => choose(onRename)}><Pencil size={15} />Rename project</Button>
        {!!recent.length && <div role="group" aria-label="Recent projects" className="project-menu-recents"><span aria-hidden="true">Recent projects</span>{recent.map(project => <Button role="menuitem" key={project.path} title={project.path} disabled={busy || pending || project.path === path} onClick={() => void switchProject(project.path)}><span>{project.name}</span>{project.path === path && <small>Current</small>}</Button>)}</div>}
      </Menu>
      {busy && <Text className="project-menu-note">Stop the pipeline before switching.</Text>}
      {error && <Text role="alert" className="project-menu-note">{error}</Text>}
    </div>}
  </div>;
}
