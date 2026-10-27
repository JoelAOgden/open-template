import { Actions } from '../../components/patterns/View';
import { Text } from "../../components/ui/Typography";
import { Button } from "../../components/ui/Button";
import { useEffect, useRef, useState } from "react";
import { providerLabel, type Provider } from "../../../shared/agent-settings";
import type { ServiceStatus } from "../../../shared/service-setup";
import { api } from "../../lib/api";

export function ServiceConnection({ provider, disabled }: { provider: Provider; disabled: boolean ;}) {
  const [status, setStatus] = useState<ServiceStatus>();
  const [checking, setChecking] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const generation = useRef(0);
  const refresh = async () => {
    const request = ++generation.current;
    setChecking(true); setError("");
    try { const next = await api<ServiceStatus>(`/services/status?provider=${provider}`); if (request === generation.current) setStatus(next); }
    catch (e) { if (request === generation.current) setError((e as Error).message); }
    finally { if (request === generation.current) setChecking(false); }
  };
  useEffect(() => {
    void refresh();
    const focus = () => void refresh(); window.addEventListener("focus", focus);
    return () => { generation.current++; window.removeEventListener("focus", focus); };
  }, [provider]);
  const launch = async () => {
    setLaunching(true); setError(""); setMessage("");
    try { const result = await api<{ message: string ;}>("/services/setup", { provider, action: "login" }); setMessage(result.message); }
    catch (e) { setError((e as Error).message); }
    finally { setLaunching(false); }
  };
  return <section className="service-connection" aria-label={`${providerLabel(provider)} connection`}>
    <Text role="status">{checking ? "Checking service…" : status?.message ?? "Connection status unavailable."}</Text>
    {status?.version && <Text className="settings-note">{status.version}</Text>}
    {error && <Text role="alert">{error}</Text>}
    {message && <Text role="status">{message}</Text>}
    <Actions className="actions">
      <Button type="button" disabled={disabled || launching || checking || !status?.installed} onClick={() => void launch()}>
        {launching ? "Opening terminal…" : status?.auth === "signed-in" ? "Sign in with another account" : "Sign in"}
      </Button>
      <Button type="button" variant="quiet" disabled={launching || checking} onClick={() => void refresh()}>Refresh status</Button>
    </Actions>
    <Text className="settings-note">Included with open-template. Sign in opens the service’s official login flow in your terminal and browser.</Text>
  </section>;
}
