import { useEffect, useRef, useState } from "react";
import { Sparkles, Upload, X } from "lucide-react";
import type { DocNode, Document } from "../../../shared/model";
import { imageGenerationUnavailableReason, type BlockAIProposal } from "../../../shared/block-ai";
import type { Provider } from "../../../shared/agent-settings";
import { Button } from "../../components/ui/Button";
import { Dialog, useDialog } from "../../components/ui/Dialog";
import { Label, Textarea } from "../../components/ui/Fields";
import { Heading, Text } from "../../components/ui/Typography";
import { Actions, ViewHeader } from "../../components/patterns/View";
import { api } from "../../lib/api";

export function ImageBlockChoice({ provider, onUpload, onGenerate, onClose }: { provider?: Provider; onUpload: () => void; onGenerate: () => void; onClose: () => void }) {
  const dialog = useDialog();
  const unavailable = imageGenerationUnavailableReason(provider);
  return <Dialog ref={dialog} className="modal block-ai-dialog" aria-label="Add image block" onCancel={event => { event.preventDefault(); onClose(); }}>
    <ViewHeader className="modal-heading"><Heading level={2}>Add image block</Heading><Button iconOnly aria-label="Close image options" onClick={onClose}><X size={18} /></Button></ViewHeader>
    <Actions><Button onClick={onUpload}><Upload size={16} />Upload image</Button><Button disabled={!!unavailable} aria-describedby={unavailable ? "image-generation-unavailable" : undefined} onClick={onGenerate}><Sparkles size={16} />Generate with AI</Button></Actions>
    <Text id="image-generation-unavailable" className="muted">{unavailable ?? "Create an image with AI or upload an existing image."}</Text>
  </Dialog>;
}

export function BlockAIDialog({ provider, document, block, onApply, onClose }: { provider?: Provider; document: Document; block: DocNode | null; onApply: (node: DocNode) => void; onClose: () => void }) {
  const dialog = useDialog();
  const [prompt, setPrompt] = useState("");
  const [proposal, setProposal] = useState<BlockAIProposal | null>(null);
  const [pending, setPending] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const image = !block || block.type === "image";
  const unavailable = image ? imageGenerationUnavailableReason(provider) : null;
  const generate = async () => {
    if (pending || !prompt.trim() || unavailable) return;
    const request = controller.current = new AbortController();
    setPending(true); setError(""); setProposal(null);
    try { setProposal(await api<BlockAIProposal>("/block-ai", { document, block, prompt }, "POST", request.signal)); }
    catch (e) { if (!request.signal.aborted) setError((e as Error).message); }
    finally { if (!request.signal.aborted) setPending(false); }
  };
  const apply = async () => {
    if (!proposal || applying || unavailable) return;
    setApplying(true); setError("");
    try {
      if (proposal.imageBase64) await api("/assets", { base64: proposal.imageBase64 });
      onApply(proposal.node);
      onClose();
    } catch (e) { setError((e as Error).message); }
    finally { setApplying(false); }
  };
  const close = () => { if (!applying) { controller.current?.abort(); onClose(); } };
  return <Dialog ref={dialog} className="modal block-ai-dialog" aria-label={image ? "Generate image with AI" : "Edit block with AI"} onCancel={event => { event.preventDefault(); close(); }}>
    <ViewHeader className="modal-heading"><Heading level={2}>{image ? "Generate image with AI" : "Edit block with AI"}</Heading><Button iconOnly aria-label="Close AI prompt" disabled={applying} onClick={close}><X size={18} /></Button></ViewHeader>
    <Text id="block-ai-availability" className="muted">{unavailable ?? (image ? "Describe the image you want to create. Uses your AI provider and model from Settings." : "Ask your AI provider to write or revise this block. Review the result before using it.")}</Text>
    <form onSubmit={event => { event.preventDefault(); void generate(); }}>
      <Label htmlFor="block-ai-prompt">{image ? "Describe your image" : "What would you like to add or change?"}</Label>
      <Textarea id="block-ai-prompt" autoFocus rows={4} maxLength={12000} placeholder={image ? "A simple illustration of…" : "Write requirements for…"} value={prompt} disabled={pending || applying || !!unavailable} onChange={event => { setPrompt(event.target.value); setProposal(null); }} />
      <Actions><Button type="submit" disabled={!prompt.trim() || applying || !!unavailable} aria-describedby={unavailable ? "block-ai-availability" : undefined} loading={pending}><Sparkles size={15} />{pending ? "Generating…" : "Generate"}</Button></Actions>
    </form>
    {pending && <Text role="status">Waiting for your AI provider…</Text>}
    {error && <Text role="alert">{error}</Text>}
    {proposal && <section className="block-ai-preview" aria-label="AI content preview">
      <Heading level={3}>Preview</Heading>
      {(proposal.node.type === "text" || proposal.node.type === "heading") && <div className="block-ai-text">{proposal.node.text}</div>}
      {proposal.node.type === "list" && (proposal.node.ordered ? <ol>{proposal.node.items.map((item, i) => <li key={i}>{item}</li>)}</ol> : <ul>{proposal.node.items.map((item, i) => <li key={i}>{item}</li>)}</ul>)}
      {proposal.node.type === "table" && <div className="table-wrap"><table><tbody>{proposal.node.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>}
      {proposal.node.type === "image" && <img src={`data:image/${proposal.node.assetId.endsWith(".svg") ? "svg+xml" : proposal.node.assetId.endsWith(".jpg") ? "jpeg" : proposal.node.assetId.split(".").at(-1)};base64,${proposal.imageBase64}`} alt={proposal.node.alt} />}
    </section>}
    <Actions><Button variant="quiet" disabled={applying} onClick={close}>{pending ? "Cancel generation" : "Cancel"}</Button>{proposal && <Button variant="primary" disabled={!!unavailable} loading={applying} onClick={() => void apply()}>Use content</Button>}</Actions>
  </Dialog>;
}
