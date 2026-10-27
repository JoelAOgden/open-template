import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog, useDialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Heading, Text } from '../ui/Typography';
type Options = { title?: string; confirmLabel?: string; alert?: boolean ;};
type Confirm = (message: string, options?: Options) => Promise<boolean>;
const Context = createContext<Confirm>(() => Promise.resolve(false));
export const useConfirm = () => useContext(Context);
function Prompt({ message, options, resolve }: { message: string; options: Options; resolve: (answer: boolean) => void ;}) {
  const ref = useDialog();
  return <Dialog ref={ref} className="modal" aria-label={options.title ?? 'Confirm action'} onCancel={e => { e.preventDefault(); resolve(false); }}>
    <Heading>{options.title ?? 'Confirm action'}</Heading><Text className="confirmation-message">{message}</Text>
    <div className="actions">{!options.alert && <Button onClick={() => resolve(false)}>Keep working</Button>}<Button variant="primary" onClick={() => resolve(true)}>{options.confirmLabel ?? (options.alert ? 'Close' : 'Continue')}</Button></div>
  </Dialog>;
}
export function ConfirmProvider({ children }: { children: ReactNode ;}) {
  const [request, setRequest] = useState<{ message: string; options: Options; resolve: (value: boolean) => void ;} | null>(null);
  const pending = useRef<((value: boolean) => void) | null>(null);
  useEffect(() => () => { pending.current?.(false); }, []);
  const confirm: Confirm = (message, options = {}) => new Promise(resolve => { pending.current?.(false); pending.current = resolve; setRequest({ message, options, resolve }); });
  return <Context.Provider value={confirm}>{children}{request && <Prompt {...request} resolve={value => { request.resolve(value); pending.current = null; setRequest(null); }} />}</Context.Provider>;
}
