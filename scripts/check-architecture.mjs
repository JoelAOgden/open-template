import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
export function checkFile(file, text) {
 const failures=[];
 file=file.replaceAll('\\','/');
 if(file.endsWith('.tsx')){
  const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  function visit(node){
   if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&!file.includes('components/ui/')){
    const tag=node.tagName.getText(source);
    if(['button','select','option','input','textarea','label','dialog','h1','h2','h3','h4','h5','h6','p','pre'].includes(tag))failures.push(`${file}: use the shared component for <${tag}>`);
   }
   ts.forEachChild(node,visit);
  }visit(source);
 }
 if(!file.includes('/theme/')&&file.endsWith('.css')&&/#[\da-f]{3,8}\b|rgba?\(/i.test(text))failures.push(`${file}: move literal colours into the theme`);
 if(file.includes('/components/')&&/from ['"][^'"]*features\//.test(text))failures.push(`${file}: shared components cannot import feature implementations`);
 if(file.endsWith('.tsx')&&/\b(?:window\.)?(?:confirm|alert|prompt)\(/.test(text)&&!file.includes('catalogue/'))failures.push(`${file}: use a shared dialog`);
 return failures;
}
async function scan(directory){
 const failures=[];
 for(const entry of await fs.readdir(directory,{withFileTypes:true})){
  const file=path.join(directory,entry.name);
  if(entry.isDirectory()){failures.push(...await scan(file));continue;}
  if(!/\.(tsx?|css)$/.test(file))continue;
  failures.push(...checkFile(file,await fs.readFile(file,'utf8')));
 }
 return failures;
}
if(process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href){
 const failures=await scan('src');
 if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log('Architecture checks passed: shared controls, theme colours and dependency boundaries.');
}
