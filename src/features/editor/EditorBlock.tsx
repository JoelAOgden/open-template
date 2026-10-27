import type { DocNode } from '../../../shared/model';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Fields';
import { Trash2, List, Plus } from 'lucide-react';
import { Asset, WritingArea } from './EditorBlocks';
export function EditorBlock({ node, index, selected, onSelect, onRemove, onChange }: { node: DocNode; index: number; selected: string | null; onSelect: (id: string) => void; onRemove: () => void; onChange: (node: DocNode) => void ;}) {
  return (<div
    id={`node-${node.id}`}
    className={`editor-node node-${node.type} ${selected === node.id ? "selected" : ""}`}
    onFocus={() => onSelect(node.id)}
  >
    <Button
      iconOnly className="node-delete"
      aria-label={`Delete ${node.type} block ${index + 1}`}
      title="Delete block"
      onClick={onRemove}
    >
      <Trash2 size={14} />
    </Button>
    <Input
      className="block-title"
      aria-label={`Block ${index + 1} title`}
      placeholder="Block title…"
      maxLength={200}
      value={node.title ?? ""}
      onChange={event => onChange({ ...node, title: event.target.value })}
    />
    {(node.type === "text" || node.type === "heading") && (
      <WritingArea
        label={
          index === 0 ? "Definition text" : `Text block ${index + 1}`
        }
        value={node.text}
        onChange={(text) => onChange({ ...node, text })}
        placeholder="Write…"
        className={
          node.type === "heading"
            ? "node-heading"
            : `text-${node.color}`
        }
        style={
          node.type === "text"
            ? {
              fontWeight: node.bold ? 650 : 400,
              fontStyle: node.italic ? "italic" : "normal",
            }
            : {}
        }
      />
    )}
    {node.type === "list" && (
      <>
        <div className="node-label">
          <Button
            iconOnly
            title={node.ordered ? "Use bullets" : "Use numbers"}
            aria-label={node.ordered ? "Use bullets" : "Use numbers"}
            onClick={() =>
              onChange({ ...node, ordered: !node.ordered })
            }
          >
            <List size={14} />
          </Button>
        </div>
        <div className="list-edit">
          <div aria-hidden>
            {node.items.map((_, i) => (
              <div key={i}>{node.ordered ? `${i + 1}.` : "•"}</div>
            ))}
          </div>
          <WritingArea
            label="List items"
            value={node.items.join("\n")}
            onChange={(text) =>
              onChange({
                ...node,
                items: text.split("\n"),
              })
            }
            placeholder="List item…"
          />
        </div>
      </>
    )}
    {node.type === "table" && (
      <>
        <div className="table-wrap">
          <table className="edit-table">
            <tbody>
              {node.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>
                      <Input
                        aria-label={`Table row ${ri + 1} column ${ci + 1}`}
                        placeholder={
                          ri === 0 ? `Column ${ci + 1}` : "…"
                        }
                        value={cell}
                        onChange={(e) =>
                          onChange({
                            ...node,
                            rows: node.rows.map((r, i) =>
                              i === ri
                                ? r.map((c, j) =>
                                  j === ci ? e.target.value : c,
                                )
                                : r,
                            ),
                          })
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-actions">
          <Button
            variant="quiet" size="small"
            disabled={node.rows.length >= 100}
            onClick={() =>
              onChange({
                ...node,
                rows: [...node.rows, node.rows[0].map(() => "")],
              })
            }
          >
            <Plus size={12} /> Row
          </Button>
          <Button
            variant="quiet" size="small"
            disabled={node.rows[0].length >= 12}
            onClick={() =>
              onChange({
                ...node,
                rows: node.rows.map((r) => [...r, ""]),
              })
            }
          >
            <Plus size={12} /> Column
          </Button>
          <Button
            variant="quiet" size="small"
            disabled={node.rows.length <= 1}
            onClick={() =>
              onChange({
                ...node,
                rows: node.rows.slice(0, -1),
              })
            }
          >
            Remove row
          </Button>
        </div>
      </>
    )}
    {node.type === "image" && (
      <figure>
        <Asset id={node.assetId} alt={node.alt} />
        <Input
          className="image-caption"
          aria-label="Image caption"
          value={node.alt}
          onChange={(e) =>
            onChange({ ...node, alt: e.target.value })
          }
          placeholder="Caption…"
        />
      </figure>
    )}
  </div>);
}
