import { useEffect } from 'react';
import { api } from '../lib/api';
export function useDesktopGuards(saveStatus: string, flush: () => Promise<boolean>, setError: (message: string) => void) {
  useEffect(() => { const prevent = (e: BeforeUnloadEvent) => { if (saveStatus !== 'All changes saved') e.preventDefault(); }; window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent); }, [saveStatus]);
  useEffect(() => { const prevent = (event: DragEvent) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); }; window.addEventListener('dragover', prevent); window.addEventListener('drop', prevent); return () => { window.removeEventListener('dragover', prevent); window.removeEventListener('drop', prevent); }; }, []);
  useEffect(() => { const close = () => { void (async () => { if (!await flush()) { setError('Could not save the editor. Finish the current operation and close the window again.'); return; } try { await api('/desktop/close', {}); } catch (error) { setError((error as Error).message); } })(); }; window.addEventListener('open-template-close', close); return () => window.removeEventListener('open-template-close', close); });
}
