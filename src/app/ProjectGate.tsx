import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { ProjectChooser, type ProjectList } from '../features/projects/ProjectsDialog';
import { Heading } from '../components/ui/Typography';
import { Button } from '../components/ui/Button';
import { ErrorState, LoadingState } from '../components/patterns/Feedback';
import { useDesktopGuards } from './useDesktopGuards';

function ProjectSetup() {
  const [error, setError] = useState('');
  useDesktopGuards('All changes saved', async () => true, setError);
  return <main className="project-setup"><section className="projects-dialog project-setup-panel">
    <Heading level={1}>open-template</Heading>
    {error && <ErrorState>{error}</ErrorState>}
    <ProjectChooser />
  </section></main>;
}
export function ProjectGate({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void api<ProjectList>('/projects').then(result => setSelected(!!result.current)).catch(error => setError(error.message)); }, []);
  if (error) return <main className="project-setup"><ErrorState>{error}</ErrorState><Button onClick={() => location.reload()}>Retry</Button></main>;
  if (selected === null) return <LoadingState>Opening open-template…</LoadingState>;
  return selected ? children : <ProjectSetup />;
}
