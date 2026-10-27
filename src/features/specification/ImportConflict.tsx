import { Field } from '../../components/ui/Field';
import { Actions } from '../../components/patterns/View';
import { Heading } from "../../components/ui/Typography";
import { Dialog, useDialog } from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { Select, Option } from "../../components/ui/Select";
import { useState } from "react";
import type { Document } from "../../../shared/model";
import type { ImportResolution } from "../../../shared/imports";

export function ImportConflict({
  name,
  matches,
  choose,
}: {
  name: string;
  matches: Document[];
  choose: (resolution: ImportResolution | null) => void;
}) {
  const dialog = useDialog();
  const [selected, setSelected] = useState(matches.length === 1 ? matches[0].id : "");
  const document = matches.find((doc) => doc.id === selected);
  return (
    <Dialog
      ref={dialog}
      className="modal import-conflict"
      aria-labelledby="import-conflict-title"
      onCancel={(event) => {
        event.preventDefault();
        choose(null);
      }}
    >
      <Heading level={2} id="import-conflict-title">Replace “{name}”?</Heading>
      {matches.length > 1 && (
        <Field label="Document to replace">
          <Select value={selected} onChange={(event) => setSelected(event.target.value)}>
            <Option value="" disabled>Choose document</Option>
            {matches.map((doc, index) => {
              const node = doc.nodes[0];
              const preview = !node ? "Empty" : "text" in node ? node.text
                : node.type === "image" ? node.alt
                  : node.type === "list" ? node.items.join(", ")
                    : node.rows.flat().join(", ");
              return <Option key={doc.id} value={doc.id}>{index + 1}. {preview.slice(0, 100)}</Option>;
            })}
          </Select>
        </Field>
      )}
      <Actions className="actions">
        <Button variant="quiet" autoFocus onClick={() => choose(null)}>Cancel</Button>
        <Button onClick={() => choose({ action: "keep_both" })}>Keep both</Button>
        <Button
          variant="primary"
          disabled={!document}
          onClick={() => {
            if (document) choose({ action: "replace", documentId: document.id, version: document.version });
          }}
        >Replace</Button>
      </Actions>
    </Dialog>
  );
}
