import { hostPlatform, launcherGuidance } from "./launcher.js";
import type { RuntimePlatform } from "../shared/runtime-platform.js";
import fs from "node:fs/promises";
import type { Snapshot } from "../shared/model.js";
import { atomicWrite, checkedPath } from "./files.js";

// Exports are app-owned references, distinct from user-authored documents/skills.
export function workspaceReferences(snapshot: Snapshot, platform: RuntimePlatform = hostPlatform()): Map<string, string> {
  const files = new Map<string, string>();
  const sections = snapshot.project.sections.map(s => ({ id: s.id, name: s.displayName, slug: s.slug,
    skill: `.agents/skills/${s.slug}/SKILL.md`, documents: snapshot.project.documents.filter(d => d.sectionId === s.id).map(d => ({ id: d.id, title: d.title, path: `spec/${s.slug}/${d.id}.md` })) }));
  files.set("AGENTS.md", `# ${snapshot.project.name}

Implement in output/ only. Specifications, skills and changes are read-only references. Read spec/index.json for the project definition and relevant section skills; changes/index.json lists this run's diffs. Preserve unrelated working behavior and explicit user choices.

Plan and implement the current request yourself; no separate plan approval is needed. Architecture and Testing guide your technology and checks. Choose checks appropriate to the change; report limitations honestly. Give occasional one-sentence, plain-language progress updates about the work actually underway, especially when changing focus. Do not invent progress or narrate every command. Reply normally when finished. No separate analysis reports or verification stages are required.

${launcherGuidance(platform)} Web servers may print a local URL; other programs need no URL. Document prerequisites. Studio does not impose a launch test.

Resolve ordinary product choices yourself. If a new product assumption needs recording, optionally write .studio/decisions.json in output/ as an array of {"key":"stable-key","choice":"short choice","reason":"short reason"}. The app saves these in AI decisions; do not edit definitions directly. Keep choices under 180 characters and reasons under 100, at most eight notes. Reuse existing keys from ../results/context.json; user edits and deletions take precedence.

## Sections
${sections.map(s => `- ${s.name}: ${s.skill}; documents listed in spec/index.json`).join("\n")}
`);
  files.set("spec/index.json", JSON.stringify({ name: snapshot.project.name, snapshotHash: snapshot.hash, sections }, null, 2));
  for (const section of sections) {
    const custom = snapshot.skills[section.slug] ?? "";
    files.set(section.skill, `---\nname: ${section.slug}\ndescription: ${JSON.stringify(`Interpret and implement the ${section.name} requirements for this project.`)}\n---\n\n# ${section.name}\n\nRead the authoritative documents below. Use this section as a focus while respecting the whole specification. Inspect the code before deciding what remains missing.\n\n${section.documents.map(d => `- ${d.title}: spec/${section.slug}/${d.id}.md (relative to project root)`).join("\n")}\n\n## User section guidance\n${custom.replace(/^---\n[\s\S]*?\n---\n/, "")}\n`);
    for (const document of section.documents) files.set(document.path, snapshot.markdown[`${section.slug}/${document.id}.md`] ?? "");
  }
  return files;
}
export async function exportCurrentWorkspace(dataDir: string, snapshot: Snapshot) {
  const files = workspaceReferences(snapshot);
  // Only remove previously generated inventory entries, never user documents.
  let previous: string[] = [];
  try { previous = JSON.parse(await fs.readFile(await checkedPath(dataDir, "workspace-files.json"), "utf8")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  for (const file of previous) if (!files.has(file)) await fs.rm(await checkedPath(dataDir, `workspace/${file}`), { force: true });
  for (const [file, text] of files) await atomicWrite(dataDir, `workspace/${file}`, text);
  for (const asset of new Set(snapshot.project.documents.flatMap(d => d.assetRefs))) {
    const from = await checkedPath(dataDir, `assets/${asset}`);
    await atomicWrite(dataDir, `workspace/assets/${asset}`, await fs.readFile(from));
  }
  await atomicWrite(dataDir, "workspace-files.json", JSON.stringify([...files.keys()]));
}
