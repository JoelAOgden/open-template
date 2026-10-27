import { launcher } from "./launcher.js";
import { DEFAULT_SECTION_NAMES, isDefaultSection } from "../shared/sections.js";
import { templateNodes, upgradeStarterDocument } from "../shared/section-templates.js";
import { exportCurrentWorkspace } from "./workspace-export.js";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ImportSchema, imageExtension, prepareImports, availableImportName } from "./imports.js";
import { importNameKey } from "../shared/imports.js";
import { AgentSettingsSchema, DEFAULT_AGENT_SETTINGS, type AgentSettings } from "../shared/agent-settings.js";
import {
  DocumentSchema,
  SectionSchema,
  slugify,
  type DocNode,
  type Project,
  type Snapshot,
  type PlanSession,
  type Run,
  type RunInfo,
  type Document,
  type PromptInfo,
  type PromptRecord,
  type CheckpointInfo,
} from "../shared/model.js";
import {
  AppError,
  atomicWrite,
  checkedPath,
  ensureRoot,
  hash,
  readSafe,
  manifest,
} from "./files.js";

const ProjectSchema = z.object({
  name: z.string().min(1).max(80),
  sections: z.array(SectionSchema).max(50),
  documents: z.array(DocumentSchema),
});
const paragraph = (text = ""): DocNode => ({
  id: randomUUID(),
  type: "text",
  text,
  bold: false,
  italic: false,
  color: "default",
});
const escapeTable = (s: string) =>
  s.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
export function markdown(project: Project) {
  const result: Record<string, string> = {};
  for (const section of project.sections) {
    for (const doc of project.documents.filter(
      (d) => d.sectionId === section.id,
    )) {
      const content = doc.nodes
        .map((n) => {
          const content = (() => {
          switch (n.type) {
            case "text":
              return n.bold
                ? `**${n.text}**`
                : n.italic
                  ? `*${n.text}*`
                  : n.text;
            case "heading":
              return `${"#".repeat(Number(n.level))} ${n.text}`;
            case "list":
              return n.items
                .map((t, i) => `${n.ordered ? i + 1 + "." : "-"} ${t}`)
                .join("\n");
            case "image":
              return `![${n.alt.replace(/[\[\]\n]/g, "")}](../../assets/${n.assetId})`;
            case "table":
              return n.rows
                .map(
                  (r, i) =>
                    `| ${r.map(escapeTable).join(" | ")} |${i === 0 ? "\n| " + r.map(() => "---").join(" | ") + " |" : ""}`,
                )
                .join("\n");
          }
          })();
          return n.title?.trim() ? `## ${n.title.trim()}\n\n${content}` : content;
        })
        .join("\n\n");
      result[`${section.slug}/${doc.id}.md`] = `# ${doc.title}\n\n${content}\n`;
    }
  }
  return result;
}
export class Store {
  settings: AgentSettings = { ...DEFAULT_AGENT_SETTINGS };
  dataDir: string;
  codeDir: string;
  skillDir: string;
  project!: Project;
  state: {
    appliedSnapshotHash: string | null;
    sessionId: string | null;
    runId: string | null;
    checkpoint?: CheckpointInfo;
    draftRunId?: string;
    implementationPending?: boolean;
  } = { appliedSnapshotHash: null, sessionId: null, runId: null };
  constructor(public root: string, public layout: "legacy" | "folder" = "legacy") {
    this.dataDir = path.join(root, layout === "folder" ? ".project-studio" : ".project-ide");
    this.codeDir = layout === "folder" ? root : path.join(root, "project_src");
    this.skillDir = path.join(root, ".agents");
  }
  projectManifest(directory = this.codeDir) { return manifest(directory, this.layout === "folder" ? ["AGENTS.md"] : []); }
  async init() {
    await ensureRoot(this.root);
    await ensureRoot(this.dataDir);
    await ensureRoot(this.codeDir);
    await ensureRoot(this.skillDir);
    try {
      this.project = ProjectSchema.parse(
        JSON.parse(
          (
            await readSafe(this.dataDir, "project.json", false, Infinity)
          ).toString(),
        ),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      this.project = { name: this.layout === "folder" ? path.basename(this.root).slice(0,80) : "My Project", sections: [], documents: [] };
      for (const name of DEFAULT_SECTION_NAMES)
        this.appendSection(name);
      if (this.layout === "folder") {
        // Seed only a newly initialized project, never alter a saved baseline.
        const launch = launcher();
        const launcherPath = await checkedPath(this.codeDir,launch.filename,true);
        await fs.writeFile(launcherPath,launch.stub,{flag:"wx"}).catch(e=>{if(e.code!=="EEXIST")throw e;});
      }
      await this.saveProject();
    }
    try {
      this.state = JSON.parse(
        (await readSafe(this.dataDir, "state.json")).toString(),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    for (const s of this.project.sections)
      await this.ensureSkill(s.slug, s.displayName);
    try {
      this.settings = AgentSettingsSchema.parse(await this.load("settings.json"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (this.layout === "folder" && !this.state.appliedSnapshotHash && !Object.keys(await this.projectManifest()).length) {
      const active = await checkedPath(this.dataDir,"workflow-active.json");
      const hasRun = await fs.lstat(active).then(()=>true).catch(e=>{if(e.code === "ENOENT")return false;throw e;});
      if (!hasRun) await fs.writeFile(await checkedPath(this.codeDir,launcher().filename,true),launcher().stub,{flag:"wx"}).catch(e=>{if(e.code!=="EEXIST")throw e;});
    }
    let upgraded = false;
    this.project.documents = this.project.documents.map(doc => {
      const section = this.project.sections.find(s => s.id === doc.sectionId);
      const next = section && doc.title === section.displayName ? upgradeStarterDocument(doc, section.slug) : doc;
      if (next !== doc) upgraded = true;
      return next;
    });
    if (upgraded) await this.saveProject();
    else await this.exportDefinitions();
  }
  async saveSettings(input: unknown) {
    const settings = AgentSettingsSchema.parse(input);
    await atomicWrite(this.dataDir, "settings.json", JSON.stringify(settings));
    this.settings = settings;
    return settings;
  }
  appendSection(name: string) {
    const slug = slugify(name);
    if (!slug || slug.length > 70 || ["con", "nul", "aux"].includes(slug))
      throw new AppError("Use a section name containing letters or numbers.");
    if (this.project.sections.some((s) => s.slug === slug))
      throw new AppError("A section with that name already exists.", 409);
    if (this.project.sections.length >= 50)
      throw new AppError("Maximum 50 sections.");
    const sectionId = randomUUID(),
      docId = randomUUID();
    this.project.sections.push({
      id: sectionId,
      slug,
      displayName: name.trim(),
      skillId: slug,
      documentIds: [docId],
    });
    this.project.documents.push({
      id: docId,
      sectionId,
      title: name.trim(),
      nodes: templateNodes(slug, randomUUID),
      assetRefs: [],
      version: 0,
    });
    return this.project.sections.at(-1)!;
  }
  async ensureSkill(slug: string, name: string) {
    const relative = `skills/${slug}/SKILL.md`;
    const file = await checkedPath(this.skillDir, relative);
    try {
      await fs.access(file);
    } catch {
      await atomicWrite(
        this.skillDir,
        relative,
        `---\nname: ${slug}\ndescription: ${JSON.stringify(`Interpret the ${name} section of this project's definition.`)}\n---\n\n# ${name.replace(/[\r\n]/g, " ")}\n\nUse the supplied ${slug} documents as requirements. Preserve explicit user choices. Read .project-studio/workspace/spec/index.json when this is a folder project to find the current documents. Explain product assumptions concisely in AI decisions. Propose definition changes separately; never edit authoritative definitions or skills. Implement the requested changes in the supplied project working directory.\n`,
      );
    }
  }
  async addSection(name: string) {
    const old = structuredClone(this.project);
    try {
      const s = this.appendSection(name);
      await this.ensureSkill(s.slug, s.displayName);
      await this.saveProject();
      return s;
    } catch (e) {
      this.project = old;
      throw e;
    }
  }
  async addDocument(sectionId: string, title: string, nodes: DocNode[] = []) {
    const previous = structuredClone(this.project);
    const section = this.project.sections.find((s) => s.id === sectionId);
    if (!section) throw new AppError("Section not found.", 404);
    const doc = DocumentSchema.parse({
      id: randomUUID(),
      sectionId,
      title,
      nodes,
      assetRefs: [
        ...new Set(
          nodes.flatMap((node) => node.type === "image" ? [node.assetId] : []),
        ),
      ],
      version: 0,
    });
    if (new Set(doc.nodes.map((node) => node.id)).size !== doc.nodes.length)
      throw new AppError("Node IDs must be unique.");
    for (const asset of doc.assetRefs)
      await readSafe(this.dataDir, `assets/${asset}`, false, Infinity);
    section.documentIds.push(doc.id);
    this.project.documents.push(doc);
    try {
      await this.saveProject();
    } catch (e) {
      this.project = previous;
      for (const relative of [
        `documents/${doc.id}.json`,
        `generated/${section.slug}/${doc.id}.md`,
      ])
        await fs.rm(await checkedPath(this.dataDir, relative), { force: true });
      throw e;
    }
    return doc;
  }
  async saveDocument(id: string, value: unknown) {
    const existing = this.project.documents.find((d) => d.id === id);
    if (!existing) throw new AppError("Document not found.", 404);
    const doc = DocumentSchema.parse(value);
    if (doc.id !== id || doc.sectionId !== existing.sectionId)
      throw new AppError("Document identity cannot change.");
    if (doc.version !== existing.version)
      throw new AppError(
        "This document changed elsewhere. Reload before saving.",
        409,
      );
    const ids = new Set(doc.nodes.map((n) => n.id));
    if (ids.size !== doc.nodes.length)
      throw new AppError("Node IDs must be unique.");
    doc.assetRefs = [
      ...new Set(
        doc.nodes.flatMap((n) => (n.type === "image" ? [n.assetId] : [])),
      ),
    ];
    for (const asset of doc.assetRefs)
      await readSafe(this.dataDir, `assets/${asset}`, false, Infinity);
    doc.version++;
    const previous = this.project;
    this.project = {
      ...previous,
      documents: previous.documents.map((d) => (d.id === id ? doc : d)),
    };
    try {
      await this.saveProject();
    } catch (e) {
      this.project = previous;
      throw e;
    }
    return doc;
  }
  async deleteDocument(id: string, version: number) {
    const doc = this.project.documents.find((d) => d.id === id);
    if (!doc) throw new AppError("Document not found.", 404);
    if (doc.version !== version)
      throw new AppError(
        "This document changed elsewhere. Reload before deleting.",
        409,
      );
    return this.removeDefinitions([doc]);
  }
  async importFiles(value: unknown) {
    const { target, files } = ImportSchema.parse(value);
    const existing =
      target.kind === "document"
        ? this.project.documents.find((doc) => doc.id === target.id)
        : undefined;
    if (target.kind === "document") {
      if (!existing) throw new AppError("Document not found.", 404);
      if (existing.version !== target.version)
        throw new AppError(
          "This document changed elsewhere. Reload before importing.",
          409,
        );
    }
    const section = this.project.sections.find(
      (s) => s.id === (existing?.sectionId ?? target.id),
    );
    if (!section) throw new AppError("Section not found.", 404);
    const sectionDocuments = this.project.documents.filter(
      (doc) => doc.sectionId === section.id,
    );
    const replaced = new Set<string>();
    const replacements = files.map((file) => {
      if (existing) {
        if (file.resolution)
          throw new AppError("Replacement choices apply to section imports only.");
        return undefined;
      }
      const matches = sectionDocuments.filter(
        (doc) => importNameKey(doc.title) === importNameKey(file.name),
      );
      if (file.resolution?.action === "replace") {
        const choice = file.resolution;
        const doc = matches.find((doc) => doc.id === choice.documentId);
        if (!doc || doc.version !== choice.version)
          throw new AppError(
            `${file.name}: the document changed. Import again to review replacement.`,
            409,
          );
        if (replaced.has(doc.id))
          throw new AppError(`${file.name}: choose only one replacement for each document.`);
        replaced.add(doc.id);
        return doc;
      }
      if (matches.length && !file.resolution)
        throw new AppError(
          `${file.name} already exists. Import again and choose Replace or Keep both.`,
          409,
        );
      return undefined;
    });
    const prepared = prepareImports(files);
    const usedNames = new Set(sectionDocuments.map((doc) => importNameKey(doc.title)));
    const makeDocument = (doc: Document) =>
      DocumentSchema.parse({
        ...doc,
        assetRefs: [
          ...new Set(
            doc.nodes.flatMap((node) =>
              node.type === "image" ? [node.assetId] : [],
            ),
          ),
        ],
      });
    const documents = existing
      ? [
          makeDocument({
            ...existing,
            version: existing.version + 1,
            nodes: [
              ...existing.nodes,
              ...prepared.flatMap((file) => file.nodes),
            ],
          }),
        ]
      : prepared.map((file, index) =>
          makeDocument({
            id: replacements[index]?.id ?? randomUUID(),
            sectionId: section.id,
            title: replacements[index]?.title ?? availableImportName(file.name, usedNames),
            nodes: file.nodes,
            assetRefs: [],
            version: replacements[index] ? replacements[index].version + 1 : 0,
          }),
        );
    const previous = this.project;
    const existingIds = new Set(previous.documents.map((doc) => doc.id));
    const additions = documents.filter((doc) => !existingIds.has(doc.id));
    const updates = new Map(documents.map((doc) => [doc.id, doc]));
    const next = {
      ...previous,
      sections: existing
        ? previous.sections
        : previous.sections.map((s) =>
            s.id === section.id
              ? {
                  ...s,
                  documentIds: [
                    ...s.documentIds,
                    ...additions.map((doc) => doc.id),
                  ],
                }
              : s,
          ),
      documents: [
        ...previous.documents.map((doc) => updates.get(doc.id) ?? doc),
        ...additions,
      ],
    };
    ProjectSchema.parse(next);
    // Validate the complete batch before writing. Preserve the previous mirrors
    // so failed persistence cannot leave partially imported definitions behind.
    const backups: { relative: string; data?: Buffer }[] = [];
    for (const doc of documents) {
      for (const relative of [
        `documents/${doc.id}.json`,
        `generated/${section.slug}/${doc.id}.md`,
      ]) {
        try {
          backups.push({
            relative,
            data: await readSafe(this.dataDir, relative, false, Infinity),
          });
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          backups.push({ relative });
        }
      }
    }
    for (const file of prepared)
      if (file.asset)
        await atomicWrite(
          this.dataDir,
          `assets/${file.asset.id}`,
          file.asset.data,
        );
    this.project = next;
    try {
      await this.saveProject();
    } catch (e) {
      this.project = previous;
      for (const backup of backups) {
        if (backup.data)
          await atomicWrite(this.dataDir, backup.relative, backup.data);
        else
          await fs.rm(await checkedPath(this.dataDir, backup.relative), {
            force: true,
          });
      }
      throw e;
    }
    return { project: this.project, documents };
  }
  async deleteSection(
    id: string,
    documents: { id: string; version: number }[],
  ) {
    const section = this.project.sections.find((s) => s.id === id);
    if (!section) throw new AppError("Section not found.", 404);
    if (isDefaultSection(section))
      throw new AppError("Default sections cannot be deleted. You can edit or delete their documents.", 409);
    const current = this.project.documents.filter((d) => d.sectionId === id);
    if (
      current.length !== documents.length ||
      new Set(documents.map((d) => d.id)).size !== documents.length ||
      current.some(
        (doc) =>
          !documents.some((d) => d.id === doc.id && d.version === doc.version),
      )
    )
      throw new AppError(
        "This section changed elsewhere. Reload before deleting.",
        409,
      );
    return this.removeDefinitions(current, id);
  }
  private async removeDefinitions(documents: Document[], sectionId?: string) {
    const previous = this.project;
    const removed = new Set(documents.map((doc) => doc.id));
    const paths = documents.flatMap((doc) => {
      const section = previous.sections.find((s) => s.id === doc.sectionId)!;
      return [
        { root: this.dataDir, relative: `documents/${doc.id}.json` },
        {
          root: this.dataDir,
          relative: `generated/${section.slug}/${doc.id}.md`,
        },
      ];
    });
    if (sectionId) {
      const section = previous.sections.find((s) => s.id === sectionId)!;
      paths.push({
        root: this.skillDir,
        relative: `skills/${section.slug}/SKILL.md`,
      });
    }
    // Only app-owned files belonging to these records are removed; assets and
    // frozen sessions remain available to existing plans and history.
    const backups: { root: string; relative: string; contents: Buffer }[] = [];
    for (const file of paths) {
      try {
        backups.push({
          ...file,
          contents: await readSafe(file.root, file.relative, false, Infinity),
        });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    this.project = {
      ...previous,
      sections: previous.sections
        .filter((s) => s.id !== sectionId)
        .map((s) => ({
          ...s,
          documentIds: s.documentIds.filter((id) => !removed.has(id)),
        })),
      documents: previous.documents.filter((doc) => !removed.has(doc.id)),
    };
    const deleted: typeof backups = [];
    try {
      for (const file of backups) {
        await fs.unlink(await checkedPath(file.root, file.relative));
        deleted.push(file);
      }
      await this.saveProject();
    } catch (e) {
      this.project = previous;
      for (const file of deleted)
        await atomicWrite(file.root, file.relative, file.contents);
      throw e;
    }
    return this.project;
  }
  async saveProject() {
    ProjectSchema.parse(this.project);
    const serialized = JSON.stringify(this.project, null, 2);
    await this.exportDefinitions();
    await atomicWrite(this.dataDir, "project.json", serialized);
  }
  async exportDefinitions() {
    for (const section of this.project.sections) await this.ensureSkill(section.slug, section.displayName);
    for (const doc of this.project.documents)
      await atomicWrite(
        this.dataDir,
        `documents/${doc.id}.json`,
        JSON.stringify(doc, null, 2),
      );
    for (const [file, contents] of Object.entries(markdown(this.project)))
      await atomicWrite(this.dataDir, `generated/${file}`, contents);
    await exportCurrentWorkspace(this.dataDir, await this.snapshot());
    if (this.layout === "folder") {
      const begin = "<!-- project-studio:begin -->", end = "<!-- project-studio:end -->";
      let existing = "";
      try { existing = (await readSafe(this.root, "AGENTS.md", false, Infinity)).toString(); }
      catch(e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      const block = `${begin}\n## open-template\nRead .project-studio/workspace/spec/index.json for current section documents and .agents/skills/ for section guidance. Explicit user requirements override AI decisions. Code lives at this repository root. Studio owns .project-studio/ and the managed section skills; do not edit definitions or run history directly.\n${end}`;
      const start = existing.indexOf(begin), finish = existing.indexOf(end);
      const next = start >= 0 && finish >= start ? existing.slice(0,start) + block + existing.slice(finish + end.length) : existing + (existing ? "\n\n" : "") + block + "\n";
      await atomicWrite(this.root,"AGENTS.md",next);
    }
  }
  async snapshot(): Promise<Snapshot> {
    const project = structuredClone(this.project),
      skills: Record<string, string> = {};
    for (const s of project.sections)
      skills[s.slug] = (
        await readSafe(this.skillDir, `skills/${s.slug}/SKILL.md`)
      ).toString();
    const md = markdown(project);
    return {
      hash: hash(JSON.stringify({ project, skills, markdown: md })),
      project,
      skills,
      markdown: md,
    };
  }
  async saveAppliedSnapshot(snapshot: Snapshot) {
    this.checkSnapshot(snapshot, snapshot.hash);
    await atomicWrite(
      this.dataDir,
      `snapshots/${snapshot.hash}.json`,
      JSON.stringify(snapshot),
    );
  }
  private checkSnapshot(snapshot: Snapshot, expected: string) {
    if (
      !/^[a-f0-9]{64}$/.test(expected) ||
      snapshot.hash !== expected ||
      hash(
        JSON.stringify({
          project: snapshot.project,
          skills: snapshot.skills,
          markdown: snapshot.markdown,
        }),
      ) !== expected
    )
      throw new AppError(
        "Applied definitions failed their integrity check.",
        409,
      );
    return snapshot;
  }
  async appliedSnapshot(
    snapshotHash = this.state.appliedSnapshotHash,
  ): Promise<Snapshot | null> {
    if (!snapshotHash) return null;
    if (!/^[a-f0-9]{64}$/.test(snapshotHash))
      throw new AppError("Invalid applied definition reference.", 409);
    try {
      return this.checkSnapshot(
        await this.load<Snapshot>(`snapshots/${snapshotHash}.json`),
        snapshotHash,
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    // Existing applied versions are also preserved inside their plan sessions.
    const directory = await checkedPath(this.dataDir, "plan-sessions");
    const entries = await fs.readdir(directory).catch((e) => {
      if (e.code === "ENOENT") return [];
      throw e;
    });
    for (const file of entries
      .filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
      .sort()) {
      const session = await this.load<PlanSession>(`plan-sessions/${file}`);
      if (session.candidateSnapshotHash === snapshotHash) {
        const snapshot = this.checkSnapshot(session.snapshot, snapshotHash);
        return snapshot;
      }
    }
    throw new AppError(
      "The applied definition snapshot is missing. Restore its saved snapshot or plan session before applying changes.",
      409,
    );
  }
  async saveState() {
    await atomicWrite(this.dataDir, "state.json", JSON.stringify(this.state));
  }
  async runs(): Promise<RunInfo[]> {
    const directory = await checkedPath(this.dataDir, "runs");
    const entries = await fs
      .readdir(directory)
      .catch((e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return [];
        throw e;
      });
    const history: RunInfo[] = [];
    for (const id of entries.filter(
      (entry) => z.string().uuid().safeParse(entry).success,
    )) {
      try {
        const run = await this.run(id);
        history.push({
          id,
          status: run.status,
          createdAt: run.createdAt,
          summary: run.summary,
          fileCount: run.changedFiles.length,
        });
      } catch (e) {
        // A new run directory may appear before its first atomic save finishes.
        if (!(e instanceof AppError && e.status === 404)) throw e;
      }
    }
    return history.sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    );
  }
  async run(id: string): Promise<Run> {
    if (!z.string().uuid().safeParse(id).success)
      throw new AppError("Invalid run ID.");
    try {
      return await this.load<Run>(`runs/${id}/run.json`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        throw new AppError("Run not found.", 404);
      throw e;
    }
  }
  async prompts(): Promise<PromptInfo[]> {
    try {
      return await this.load<PromptInfo[]>("prompts/index.json");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      return [];
    }
  }
  async prompt(id: string): Promise<PromptRecord> {
    if (!z.string().uuid().safeParse(id).success)
      throw new AppError("Invalid prompt ID.");
    try {
      return await this.load<PromptRecord>(`prompts/${id}.json`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        throw new AppError("Prompt not found.", 404);
      throw e;
    }
  }
  async load<T>(relative: string): Promise<T> {
    return JSON.parse(
      (await readSafe(this.dataDir, relative, false, Infinity)).toString(),
    );
  }
  async saveImage(base64: string) {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))
      throw new AppError("Invalid image encoding.");
    const data = Buffer.from(base64, "base64");
    if (data.toString("base64") !== base64)
      throw new AppError("Invalid image encoding.");
    const ext = imageExtension(data);
    if (!ext) throw new AppError("Use a PNG, JPEG, GIF, WebP or SVG image.");
    const assetId = `${hash(data)}.${ext}`;
    await atomicWrite(this.dataDir, `assets/${assetId}`, data);
    return assetId;
  }
}
export { paragraph };
