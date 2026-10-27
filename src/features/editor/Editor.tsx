import { ViewHeader, Toolbar } from '../../components/patterns/View';
import { useDocumentDraft } from "./useDocumentDraft";
import { Heading } from "../../components/ui/Typography";
import { Input } from "../../components/ui/Fields";
import { Button } from "../../components/ui/Button";
import { Select, Option } from "../../components/ui/Select";
import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Bold,
  Heading2,
  ImagePlus,
  Table2,
  Italic,
  List,
  Plus,
  Type,
  SlidersHorizontal,
} from "lucide-react";
import type { DocNode, Document } from "../../../shared/model";
import { EditorBlock } from "./EditorBlock";

export type EditorHandle = { flush: () => Promise<void>; };
type Props = {
  document: Document;
  onSaved: () => void;
  onError: (s: string) => void;
  onStatus: (s: string) => void;
  onImage: () => void;
  actions?: React.ReactNode;
};
export const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { document, onSaved, onError, onStatus, onImage, actions },
  ref,
) {
  const { doc, current, flush, update } = useDocumentDraft(document, { onSaved, onError, onStatus });
  const emptyNode = useRef<DocNode>({
    id: crypto.randomUUID(),
    type: "text",
    text: "",
    bold: false,
    italic: false,
    color: "default",
  });
  const [format, setFormat] = useState(false),
    [selected, setSelected] = useState<string | null>(null);
  useImperativeHandle(ref, () => ({ flush }));
  const updateNode = (id: string, next: DocNode) =>
    update({
      ...current.current,
      nodes: current.current.nodes.length
        ? current.current.nodes.map((n) => (n.id === id ? next : n))
        : [next],
    });
  const add = (type: "text" | "list" | "table") => {
    const id = crypto.randomUUID();
    const node: DocNode =
      type === "text"
        ? { id, type, text: "", bold: false, italic: false, color: "default" }
        : type === "list"
          ? { id, type, items: [""], ordered: false }
          : {
            id,
            type,
            rows: [
              ["", ""],
              ["", ""],
            ],
          };
    update({ ...current.current, nodes: [...current.current.nodes, node] });
    setSelected(id);
    setTimeout(
      () =>
        documentElement(id)
          ?.querySelector<HTMLTextAreaElement | HTMLInputElement>(
            "textarea,input",
          )
          ?.focus(),
      0,
    );
  };
  const focused = doc.nodes.find((n) => n.id === selected);
  return (
    <div className="document-canvas">
      <ViewHeader className="document-title-row">
        <Heading level={1} aria-label={doc.title}>
          <Input
            className="document-title"
            aria-label="Document title"
            value={doc.title}
            onChange={(e) =>
              update({ ...current.current, title: e.target.value })
            }
          />
        </Heading>
        <div className="document-tools">
          {actions}
          <Button
            iconOnly className={format ? "active" : ""}
            onClick={() => setFormat(!format)}
            aria-expanded={format}
            aria-label="Format"
            title="Format"
          >
            <SlidersHorizontal size={15} />
          </Button>
        </div>
      </ViewHeader>
      {format && (
        <Toolbar className="format-bar">
          {focused &&
            (focused.type === "text" || focused.type === "heading") ? (
            <>
              <Button
                title="Paragraph"
                aria-label="Paragraph"
                onClick={() =>
                  updateNode(focused.id, {
                    id: focused.id,
                    title: focused.title,
                    type: "text",
                    text: focused.text,
                    bold: false,
                    italic: false,
                    color: "default",
                  })
                }
              >
                <Type size={16} />
              </Button>
              <Button
                title="Heading"
                aria-label="Heading"
                onClick={() =>
                  updateNode(focused.id, {
                    id: focused.id,
                    title: focused.title,
                    type: "heading",
                    text: focused.text,
                    level: "2",
                  })
                }
              >
                <Heading2 size={16} />
              </Button>
              {focused.type === "text" && (
                <>
                  <Button
                    aria-label="Bold"
                    aria-pressed={focused.bold}
                    onClick={() =>
                      updateNode(focused.id, {
                        ...focused,
                        bold: !focused.bold,
                      })
                    }
                  >
                    <Bold size={16} />
                  </Button>
                  <Button
                    aria-label="Italic"
                    aria-pressed={focused.italic}
                    onClick={() =>
                      updateNode(focused.id, {
                        ...focused,
                        italic: !focused.italic,
                      })
                    }
                  >
                    <Italic size={16} />
                  </Button>
                  <Select variant="compact"
                    aria-label="Text color"
                    value={focused.color}
                    onChange={(e) =>
                      updateNode(focused.id, {
                        ...focused,
                        color: e.target.value as "default",
                      })
                    }
                  >
                    <Option value="default">Default</Option>
                    <Option value="blue">Blue</Option>
                    <Option value="green">Green</Option>
                    <Option value="amber">Amber</Option>
                  </Select>
                </>
              )}
            </>
          ) : (
            <span className="muted">Select a text block.</span>
          )}
        </Toolbar>
      )}
      <div className="document-nodes">
        {(doc.nodes.length ? doc.nodes : [emptyNode.current]).map(
          (node, index) => (
            <EditorBlock key={node.id} node={node} index={index} selected={selected} onSelect={setSelected} onChange={next => updateNode(node.id, next)} onRemove={() => update({ ...current.current, nodes: current.current.nodes.filter(n => n.id !== node.id) })} />
          ),
        )}
      </div>
      <div className="add-content" role="group" aria-label="Add content">
        <span className="add-block-label"><Plus size={16} aria-hidden="true" /> Add block</span>
        <div className="add-buttons">
          <Button onClick={() => add("text")}><Type size={15} aria-hidden="true" />Text</Button>
          <Button onClick={onImage}><ImagePlus size={15} aria-hidden="true" />Image</Button>
          <Button onClick={() => add("list")}><List size={15} aria-hidden="true" />List</Button>
          <Button onClick={() => add("table")}><Table2 size={15} aria-hidden="true" />Table</Button>
        </div>
      </div>
    </div>
  );
});
function documentElement(id: string) {
  return window.document.getElementById(`node-${id}`);
}
