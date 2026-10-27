import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { StudioState } from '../../shared/model';
import { api } from '../lib/api';
export function useWorkspaceState(importState: RefObject<{ busy: boolean; epoch: number ;}>, setError: (s: string) => void, onDraft: () => void) {
  const [state, setState] = useState<StudioState | null>(null), pollBusy = useRef(false), lastRunId = useRef('');
  const onDraftRef = useRef(onDraft); onDraftRef.current = onDraft;
  const refresh = useCallback(async () => {
    if (pollBusy.current || importState.current.busy) return;
    pollBusy.current = true;
    const epoch = importState.current.epoch;
    try {
      const s = await api<StudioState>("/state");
      if (epoch !== importState.current.epoch) return;
      setState(s);
      if (
        s.run &&
        s.draftRunId === s.run.id &&
        lastRunId.current !== s.run.id
      ) {
        onDraftRef.current();
      }
      lastRunId.current = s.run?.id ?? "";
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pollBusy.current = false;
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 1300);
    return () => clearInterval(timer);
  }, [refresh]);
  return { state, setState, refresh };
}
