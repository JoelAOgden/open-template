import { Button } from "../../components/ui/Button";
import { useEffect, useState } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import type { Project } from "../../../shared/model";
import { isDefaultSection } from "../../../shared/sections";
import type { ImportTarget } from "../../../shared/imports";
import { FileDrop } from "./FileDrop";

export function SectionTree({
  project,
  selectedSection,
  selectedDocument,
  documentActive,
  disabled,
  select,
  add,
  remove,
  importFiles,
  onError,
}: {
  project: Project;
  selectedSection?: string;
  selectedDocument?: string;
  documentActive: boolean;
  disabled: boolean;
  select: (sectionId: string, documentId: string) => Promise<boolean>;
  add: (sectionId: string) => void;
  remove: (kind: "section" | "document", id: string) => void;
  importFiles: (target: ImportTarget, files?: File[]) => void;
  onError: (message: string) => void;
}) {
  const [openSection, setOpenSection] = useState(selectedSection);
  useEffect(() => {
    setOpenSection(selectedSection);
  }, [selectedSection, selectedDocument]);
  return (
    <nav aria-label="Project sections" className="section-tree">
      <ul>
        {project.sections.map((section) => {
          const expanded = openSection === section.id;
          const active = documentActive && selectedSection === section.id;
          return (
            <li key={section.id}>
              <FileDrop
                className={`definition-row ${active ? "active" : ""}`}
                disabled={disabled}
                onFiles={(files) =>
                  importFiles({ kind: "section", id: section.id }, files)
                }
                onError={onError}
              >
                <Button
                  className="definition-link"
                  aria-label={section.displayName}
                  aria-expanded={expanded}
                  aria-current={active ? "true" : undefined}
                  aria-controls={`section-${section.id}`}
                  onClick={async () => {
                    if (active) {
                      setOpenSection(expanded ? undefined : section.id);
                      return;
                    }
                    const documentId = section.documentIds.includes(
                      selectedDocument ?? "",
                    )
                      ? selectedDocument!
                      : (section.documentIds[0] ?? "");
                    if (await select(section.id, documentId))
                      setOpenSection(section.id);
                  }}
                >
                  <span>{section.displayName}</span>
                </Button>
                <Button
                  className="icon-button definition-action definition-add"
                  aria-label={`Add document to ${section.displayName}`}
                  title="Add document"
                  disabled={disabled}
                  onClick={() => add(section.id)}
                >
                  <Plus size={13} />
                </Button>
                <Button
                  className="icon-button definition-action"
                  aria-label={`Import into section ${section.displayName}`}
                  title="Import files"
                  disabled={disabled}
                  onClick={() =>
                    importFiles({ kind: "section", id: section.id })
                  }
                >
                  <Upload size={13} />
                </Button>
                {!isDefaultSection(section) && <Button
                  className="icon-button definition-action"
                  aria-label={`Delete section ${section.displayName}`}
                  title="Delete section"
                  disabled={disabled}
                  onClick={() => remove("section", section.id)}
                >
                  <Trash2 size={12} />
                </Button>}
              </FileDrop>
              <ul
                id={`section-${section.id}`}
                hidden={!expanded}
                className="section-documents"
                aria-label={`${section.displayName} documents`}
              >
                {section.documentIds
                  .map((id) => project.documents.find((doc) => doc.id === id))
                  .filter((doc) => doc !== undefined)
                  .map((doc) => (
                    <li key={doc.id}>
                      <FileDrop
                        className={`definition-row ${documentActive && selectedDocument === doc.id ? "active" : ""}`}
                        disabled={disabled}
                        onFiles={(files) =>
                          importFiles({ kind: "document", id: doc.id }, files)
                        }
                        onError={onError}
                      >
                        <Button
                          className="definition-link"
                          aria-label={`Open document ${doc.title}`}
                          aria-current={
                            documentActive && selectedDocument === doc.id
                              ? "page"
                              : undefined
                          }
                          onClick={() => void select(section.id, doc.id)}
                        >
                          <span>{doc.title}</span>
                        </Button>
                        <Button
                          className="icon-button definition-action"
                          aria-label={`Import into document ${doc.title}`}
                          title="Import files"
                          disabled={disabled}
                          onClick={() =>
                            importFiles({ kind: "document", id: doc.id })
                          }
                        >
                          <Upload size={13} />
                        </Button>
                        <Button
                          className="icon-button definition-action"
                          aria-label={`Delete document ${doc.title}`}
                          title="Delete document"
                          disabled={disabled}
                          onClick={() => remove("document", doc.id)}
                        >
                          <Trash2 size={12} />
                        </Button>
                      </FileDrop>
                    </li>
                  ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
