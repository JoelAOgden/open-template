import { ViewHeader, Actions } from '../components/patterns/View';
import { Dialog, useDialog } from '../components/ui/Dialog';
import { Button } from '../components/ui/Button';
import { Heading, CodeBlock } from '../components/ui/Typography';
import { Input, Label } from '../components/ui/Fields';
import { X } from 'lucide-react';
export type Modal = {
  type: "section" | "document" | "project" | "skill";
  text?: string;
  title?: string;
  sectionId?: string;
} | null;
export function EditDefinitionDialog({ modal, newName, onName, onClose, onSubmit }: { modal: NonNullable<Modal>; newName: string; onName: (name: string) => void; onClose: () => void; onSubmit: () => Promise<void> ;}) {
  const ref = useDialog();
  return <Dialog ref={ref} className="modal" aria-label={modal.title ?? `Edit ${modal.type}`} onCancel={event => { event.preventDefault(); onClose(); }}>
    <ViewHeader className="modal-heading">
      <Heading level={2}>
        {modal.title ??
          (modal.type === "section"
            ? "Add section"
            : modal.type === "document"
              ? "Add document"
              : modal.type === "project"
                ? "Rename project"
                : "Agent")}
      </Heading>
      <Button
        iconOnly
        aria-label="Close dialog"
        onClick={() => onClose()}
      >
        <X size={18} />
      </Button>
    </ViewHeader>
    {modal.type === "skill" ? (
      <CodeBlock className="skill-content">{modal.text}</CodeBlock>
    ) : (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
      >
        <Label>
          {modal.type === "section"
            ? "Section name"
            : modal.type === "document"
              ? "Document title"
              : "Project name"}
          <Input
            autoFocus
            value={newName}
            onChange={(e) => onName(e.target.value)}
            maxLength={modal.type === "document" ? 200 : 70}
            required
          />
        </Label>
        <Actions className="actions">
          <Button
            type="button"
            variant="quiet"
            onClick={() => onClose()}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!newName.trim()}>
            {modal.type === "project" ? "Save" : "Create"}
          </Button>
        </Actions>
      </form>
    )}
  </Dialog>;
}
