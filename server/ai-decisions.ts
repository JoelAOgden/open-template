import type { AIDecision } from "../shared/workflow.js";
import type { Snapshot } from "../shared/model.js";
import type { Store } from "./store.js";
import { atomicWrite, hash } from "./files.js";

type Record = { key: string; nodeId: string; documentId: string; text: string };
// App-owned writes only. A changed/deleted node is a user override, including deletion.
export async function saveAIDecisions(store: Store, decisions: AIDecision[]) {
  if (!decisions.length) return [];
  const accepted: AIDecision[] = [];
  let records: Record[] = [];
  try { records = await store.load<Record[]>("ai-decisions.json"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  const previous = structuredClone(store.project), oldRecords = structuredClone(records);
  let changed = false;
  try {
    for (const decision of decisions) {
      const text = `${decision.choice} — ${decision.reason}`;
      const existing = records.find(r => r.key === decision.key);
      if (existing) {
        const doc = store.project.documents.find(d => d.id === existing.documentId);
        const node = doc?.nodes.find(n => n.id === existing.nodeId);
        if (!doc || !node || node.type !== "list" || node.items.length !== 1 || node.items[0] !== existing.text) continue;
        accepted.push(decision);
        if (text !== existing.text) { node.items = [text]; doc.version++; existing.text = text; changed = true; }
        continue;
      }
      // Reworded identical choices do not create duplicate notes.
      const section = store.project.sections.find(s => s.slug === "ai-decisions");
      if (section && store.project.documents.filter(d => d.sectionId === section.id).some(d => d.nodes.some(n => n.type === "list" && n.items.some(item => item.split(" — ")[0].toLowerCase() === decision.choice.toLowerCase())))) continue;
      if (!section && records.length) continue;
      const target = section ?? store.appendSection("AI decisions");
      let doc = store.project.documents.find(d => d.sectionId === target.id);
      if (!doc) {
        // Respect deletion of a previously generated document or section.
        if (records.length) continue;
        const { randomUUID } = await import("node:crypto");
        doc = { id: randomUUID(), sectionId: target.id, title: "AI decisions", nodes: [], assetRefs: [], version: 0 };
        store.project.documents.push(doc); target.documentIds.push(doc.id);
      }
      const nodeId = `decision-${hash(decision.key).slice(0,32)}`;
      doc.nodes.push({id:nodeId,type:"list",ordered:false,items:[text]}); doc.version++;
      accepted.push(decision);
      records.push({key:decision.key,nodeId,documentId:doc.id,text}); changed = true;
    }
    if (!changed) return accepted;
    await atomicWrite(store.dataDir,"ai-decisions.json",JSON.stringify(records));
    await store.saveProject();
    return accepted;
  } catch (e) {
    store.project = previous;
    await atomicWrite(store.dataDir,"ai-decisions.json",JSON.stringify(oldRecords));
    throw e;
  }
}

export async function decisionContext(store: Store, snapshot: Snapshot) {
  let records: Record[];
  try { records = await store.load<Record[]>("ai-decisions.json"); }
  catch(e) { if((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
  return records.map(record => {
    const node = snapshot.project.documents.find(d => d.id === record.documentId)?.nodes.find(n => n.id === record.nodeId);
    const text = node?.type === "list" ? node.items.join("; ") : node?.type === "text" ? node.text : "Deleted or replaced by user";
    return { key: record.key, text, userEdited: text !== record.text };
  });
}
