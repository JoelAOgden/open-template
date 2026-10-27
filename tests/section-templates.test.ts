import test from 'node:test';
import assert from 'node:assert/strict';
import {hasPlaceholder,templateNodes} from '../shared/section-templates.js';
import type {Document,DocNode} from '../shared/model.js';
const document=(nodes:DocNode[]):Document=>({id:'doc',sectionId:'section',title:'Requirements',nodes,version:0,assetRefs:[]});
test('placeholder detection covers document content, including lists, tables and image descriptions',()=>{
 const base=templateNodes('features',()=> 'node');
 assert.equal(hasPlaceholder(document(base)),true);
 assert.equal(hasPlaceholder(document([{...base[0],title:'{replace me}',text:'Finished body'} as DocNode])),true);
 for(const node of [
  {id:'a',type:'list',items:['Use { REPLACE ME }'],ordered:false},
  {id:'a',type:'table',rows:[['{replace me}']]},
  {id:'a',type:'heading',text:'{replace me}',level:'2'},
  {id:'a',type:'image',assetId:'a'.repeat(64)+'.png',alt:'{replace me}'},
 ] as DocNode[])assert.equal(hasPlaceholder(document([node])),true);
 assert.equal(hasPlaceholder({...document([]),title:'{replace me}'}),true);
 assert.equal(hasPlaceholder(document([])),false);
 assert.equal(hasPlaceholder(document([{...base[0],text:'Let people save notes.'} as DocNode])),false);
 assert.deepEqual(templateNodes('custom',()=> 'node'),[]);
});

test('old starter wording upgrades once while preserving custom content and titles',async()=>{
 const {upgradeStarterDocument}=await import('../shared/section-templates.js');
 const texts=['How should it look and feel? {replace me}','Colours or examples to follow: {replace me}'];
 const original=document(templateNodes('design',()=> 'node').map(({title:_,...node},i)=>({...node,text:texts[i]})));
 const upgraded=upgradeStarterDocument(original,'design');
 assert.deepEqual(upgraded.nodes.map(n=>n.title),['Look and feel','Colours and inspiration']);
 assert.equal(upgraded.version,1);
 assert.match(JSON.stringify(upgraded.nodes),/Primary colour: \{replace me\}/);
 assert.deepEqual(upgraded.nodes.map(n=>n.id),original.nodes.map(n=>n.id));
 assert.equal(upgradeStarterDocument(upgraded,'design'),upgraded);
 const titledLegacy={...original,version:1,nodes:original.nodes.map((n,i)=>({...n,title:upgraded.nodes[i].title}))};
 assert.equal(upgradeStarterDocument(titledLegacy,'design').version,2);
 const edited={...original,version:1};assert.equal(upgradeStarterDocument(edited,'design'),edited);
 const titled={...original,nodes:original.nodes.map(n=>({...n,title:'My title'}))};assert.equal(upgradeStarterDocument(titled,'design'),titled);
 const custom={...titledLegacy,nodes:titledLegacy.nodes.map(n=>({...n,text:'My own requirements'}))};assert.equal(upgradeStarterDocument(custom,'design'),custom);
});

test('key features defaults to bullets and upgrades only unchanged template content',async()=>{
 const {upgradeStarterDocument,sectionTemplates}=await import('../shared/section-templates.js');
 const defaults=templateNodes('features',()=> 'node');
 assert.equal(defaults[1].type,'list');
 const old=document([defaults[0],{id:'features',type:'text',title:'Key features',text:sectionTemplates.features[1],bold:false,italic:false,color:'default'}]);
 const converted=upgradeStarterDocument({...old,version:2},'features');
 assert.equal(converted.nodes[1].type,'list');assert.equal(converted.nodes[1].id,'features');
 assert.equal(converted.nodes[0],old.nodes[0]);
 assert.equal(upgradeStarterDocument(converted,'features'),converted);
 const edited={...old,nodes:[defaults[0],{...old.nodes[1],text:'My feature'} as DocNode]};
 assert.equal(upgradeStarterDocument(edited,'features'),edited);
});
