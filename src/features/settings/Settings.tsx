import { Field } from '../../components/ui/Field';
import { ViewHeader, Actions } from '../../components/patterns/View';
import { Heading, Text } from "../../components/ui/Typography";
import { Input } from "../../components/ui/Fields";
import { Dialog, useDialog } from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { Select, Option } from "../../components/ui/Select";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { ProviderSchema, providerLabel, ReasoningSchema, reasoningLabel, type AgentSettings, type ModelOption } from "../../../shared/agent-settings";
import { ServiceConnection } from "./ServiceConnection";
import { api } from "../../lib/api";

export function Settings({ settings: initial, busy, onSave, onClose }: {
  settings: AgentSettings;
  busy: boolean;
  onSave: (settings: AgentSettings) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useDialog();
  const [settings, setSettings] = useState(initial);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [custom, setCustom] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api<ModelOption[]>("/models").then((list) => { if (active) setModels(list); }).catch(() => { });
    return () => {
      active = false;
    };
  }, []);
  const provider = settings.provider ?? "codex";
  const availableModels = provider === "codex" ? models : [];
  const model = availableModels.find((m) => m.id === settings.model);
  const levels = model?.reasoning ?? ReasoningSchema.options;
  const submit = async () => {
    if (busy || pending) return;
    setPending(true); setError("");
    try {
      await onSave(settings);
      onClose();
    } catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  };
  return <Dialog ref={dialog} className="modal settings-dialog" aria-label="Settings"
    onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }}>
    <ViewHeader className="modal-heading">
      <Heading level={2}>Settings</Heading>
      <Button iconOnly aria-label="Close settings" disabled={pending} onClick={onClose}><X size={18} /></Button>
    </ViewHeader>
    {error && <Text role="alert">{error}</Text>}
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={busy || pending}>
        <Field label="Service">
          <Select value={provider} onChange={event => {
            setSettings({ provider: ProviderSchema.parse(event.target.value), model: null, reasoning: null });
            setCustom(false);
          }}>
            {ProviderSchema.options.map(value => <Option key={value} value={value}>{providerLabel(value)}</Option>)}
          </Select>
        </Field>
        <ServiceConnection key={provider} provider={provider} disabled={busy || pending} />
        <Field label="Model">
          <Select value={custom ? "custom" : settings.model ?? ""} onChange={(event) => {
            const value = event.target.value;
            setCustom(value === "custom");
            setSettings({ ...settings, model: value === "custom" ? "" : value || null, reasoning: null });
          }}>
            <Option value="">{providerLabel(provider)} default</Option>
            {availableModels.map((m) => <Option key={m.id} value={m.id}>{m.name}</Option>)}
            {settings.model && !model && !custom && <Option value={settings.model}>{settings.model}</Option>}
            <Option value="custom">Custom…</Option>
          </Select>
        </Field>
        {custom && <Field label="Model ID">
          <Input required maxLength={120} value={settings.model ?? ""}
            onChange={(event) => setSettings({ ...settings, model: event.target.value, reasoning: null })} />
        </Field>}
        {provider === "codex" && <Field label="Reasoning">
          <Select value={settings.reasoning ?? ""} onChange={(event) => setSettings({ ...settings, reasoning: event.target.value ? ReasoningSchema.parse(event.target.value) : null })}>
            <Option value="">{model?.defaultReasoning ? `Default (${reasoningLabel(model.defaultReasoning)})` : "Default"}</Option>
            {levels.map((effort) => <Option key={effort} value={effort}>{reasoningLabel(effort)}</Option>)}
          </Select>
        </Field>}
      </fieldset>
      <Text className="settings-note">Preferences apply to the next run. Existing runs keep their saved service, model and reasoning.</Text>
      <Actions className="actions">
        <Button type="button" variant="quiet" disabled={pending} onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy || pending || (custom && !settings.model)}>{pending ? "Saving…" : "Save"}</Button>
      </Actions>
    </form>
  </Dialog>;
}
