import { pipelineNodes, sectionNode } from "../../shared/pipeline-nodes.js";
import type { Snapshot, DefinitionDiff } from '../../shared/model.js';
import type { SectionChange, WorkflowStage } from '../../shared/workflow.js';
import { definitionPatch } from '../definition-context.js';
export type PipelineMode = 'first-project' | 'single-section' | 'small-update' | 'multi-section';
export function contentStats(before: Snapshot | null, after: Snapshot) {
  const content = (snapshot: Snapshot | null) => new Map((snapshot?.project.documents ?? []).map(doc => [doc.id, [doc.title, ...doc.nodes.flatMap(node => [...(node.title ? [node.title] : []), ...(node.type === 'list' ? node.items : node.type === 'table' ? node.rows.map(row => row.join(' | ')) : node.type === 'image' ? [JSON.stringify(node)] : [node.text])])].join('\n').replace(/\r\n/g, '\n')]));
  const left = content(before), right = content(after); let added = 0, deleted = 0;
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const patch = definitionPatch(key, left.get(key) ?? null, right.get(key) ?? null);
    for (const line of patch.split('\n').slice(2)) { if (line.startsWith('+')) added++; if (line.startsWith('-')) deleted++; }
  }
  for (const key of new Set([...Object.keys(before?.skills ?? {}), ...Object.keys(after.skills)])) {
    for (const line of definitionPatch(key, before?.skills[key] ?? null, after.skills[key] ?? null).split('\n').slice(2)) { if (line.startsWith('+')) added++; if (line.startsWith('-')) deleted++; }
  }
  const images = (s: Snapshot | null) => JSON.stringify(s?.project.documents.flatMap(d => d.nodes.filter(n => n.type === 'image')) ?? []);
  return { version: 1 as const, added, deleted, imagesChanged: images(before) !== images(after) };
}
export function selectPipeline(before: Snapshot | null, after: Snapshot, diff: DefinitionDiff, sections: SectionChange[], hasAccepted: boolean, fullSpec: boolean) {
  const stats = contentStats(before, after);
  const owners = new Set(diff.changes.map(c => c.sectionId));
  const single = !fullSpec && sections.length === 1 && owners.size === 1 && !owners.has(undefined);
  const small = !fullSpec && owners.size > 1 && !owners.has(undefined) && stats.added < 20 && stats.deleted < 20 && !stats.imagesChanged && !sections.some(s => s.removed);
  const mode: PipelineMode = !hasAccepted ? 'first-project' : single ? 'single-section' : small ? 'small-update' : 'multi-section';
  const node = (id: string, title: string, kind: WorkflowStage['kind'], sectionId?: string): WorkflowStage => ({ id, title, kind, sectionId, sessionKey: id, promptTemplate: kind === 'section' ? 'section' : kind, focusTemplate: kind === 'section' ? `section-${pipelineNodes[sectionNode(sections.find(s => s.id === sectionId)!.slug)].focus}` : undefined, nodeType: kind === 'section' ? sectionNode(sections.find(s => s.id === sectionId)!.slug) : kind as keyof typeof pipelineNodes, status: 'pending', attempts: [] });
  const order = ['features', 'design', 'architecture', 'testing'];
  const sorted = [...sections].sort((a, b) => (order.includes(a.slug) ? order.indexOf(a.slug) : 4) - (order.includes(b.slug) ? order.indexOf(b.slug) : 4));
  const stages = mode === 'small-update' ? [node('implementing-changes', 'Implementing Changes', 'implementing-changes')] : [
    ...(mode === 'single-section' ? [] : [mode === 'first-project' ? node('building-first-project', 'Building your project', 'building-first-project') : node('foundation', 'Foundation', 'foundation')]),
    ...sorted.map(s => node(`section-${s.id}`, s.name, 'section', s.id))];
  return { mode, stats, stages };
}
