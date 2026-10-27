import type { DocNode, Document } from './model.js';
const legacyTemplates: Record<string, readonly string[]> = {
  features: ['Who is this for? {replace me}', 'What should users be able to do? {replace me}'],
  design: ['How should it look and feel? {replace me}', 'Colours or examples to follow: {replace me}'],
  architecture: ['Tools or technologies to use: {replace me}', 'Where should data be stored? {replace me}'],
  testing: ['What must work? {replace me}', 'How will you check it works? {replace me}'],
};
export const sectionTemplates: Record<string, readonly string[]> = {
  features: ['Target users: {replace me}\nMain goal: {replace me}', 'Feature: {replace me}\nUser can: {replace me}'],
  design: ['Visual style: {replace me}\nLayout: {replace me}', 'Primary colour: {replace me}\nAccent colour: {replace me}\nReference designs: {replace me}'],
  architecture: ['Platform: {replace me}\nLanguages and frameworks: {replace me}', 'Data to save: {replace me}\nStorage: {replace me}'],
  testing: ['User action: {replace me}\nExpected result: {replace me}', 'Automated checks: {replace me}\nManual checks: {replace me}'],
};
const templateTitles: Record<string, readonly string[]> = {
  features: ['Audience', 'Key features'],
  design: ['Look and feel', 'Colours and inspiration'],
  architecture: ['Technology', 'Data storage'],
  testing: ['What must work', 'How to check'],
};
export function upgradeStarterDocument(document: Document, slug: string): Document {
  const legacy = legacyTemplates[slug];
  let nodes = document.nodes;
  if (legacy && nodes.length === legacy.length &&
      nodes.every((node, index) => node.type === 'text' && node.text === legacy[index] &&
        ((document.version === 0 && node.title === undefined) || (document.version === 1 && node.title === templateTitles[slug][index])) &&
        !node.bold && !node.italic && node.color === 'default')) {
    nodes = nodes.map((node,index)=>({...node,title:templateTitles[slug][index],text:sectionTemplates[slug][index]}));
  }
  if (slug === 'features') {
    const converted = nodes.map(node => node.type === 'text' && node.title === 'Key features' &&
      node.text === sectionTemplates.features[1] && !node.bold && !node.italic && node.color === 'default'
      ? featureList(node.id) : node);
    if (converted.some((node,index)=>node !== nodes[index])) nodes = converted;
  }
  return nodes === document.nodes ? document : {...document,version:document.version + 1,nodes};
}
function featureList(id: string): DocNode {
  return {id,type:'list',title:'Key features',items:['User can {replace me}','User can {replace me}'],ordered:false};
}
export function templateNodes(slug: string, id: () => string): DocNode[] {
  return (sectionTemplates[slug] ?? []).map((text,index)=>slug === 'features' && index === 1 ? featureList(id()) : {id:id(),type:'text',title:templateTitles[slug][index],text,bold:false,italic:false,color:'default'});
}
export function hasPlaceholder(document: Document): boolean {
  const text = [document.title, ...document.nodes.map(node => node.title ?? ""), ...document.nodes.flatMap(node => {
    switch (node.type) {
      case 'text': case 'heading': return [node.text];
      case 'list': return node.items;
      case 'table': return node.rows.flat();
      case 'image': return [node.alt];
    }
  })];
  return text.some(value => /\{\s*replace\s+me\s*\}/i.test(value));
}
