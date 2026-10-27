export const pipelineNodes = {
  foundation: { label: 'Foundation', prompt: 'foundation', focus: null },
  'building-first-project': { label: 'Building your project', prompt: 'building-first-project', focus: null },
  'implementing-changes': { label: 'Implementing Changes', prompt: 'implementing-changes', focus: null },
  features: { label: 'Features', prompt: 'section', focus: 'features' },
  design: { label: 'Design', prompt: 'section', focus: 'design' },
  architecture: { label: 'Architecture', prompt: 'section', focus: 'architecture' },
  testing: { label: 'Testing', prompt: 'section', focus: 'testing' },
  'custom-section': { label: 'Custom section', prompt: 'section', focus: 'generic' },
} as const;
export type PipelineNodeType = keyof typeof pipelineNodes;
export function sectionNode(slug: string): PipelineNodeType { return ['features', 'design', 'architecture', 'testing'].includes(slug) ? slug as PipelineNodeType : 'custom-section'; }
