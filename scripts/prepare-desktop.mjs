import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {appRoot, prepareServices} from './prepare-services.mjs';
const desktop=path.join(appRoot,'src-tauri');
const target=execFileSync('rustc',['-vV'],{encoding:'utf8'}).match(/^host: (.+)$/m)?.[1];
if (!target) throw new Error('Cannot determine the Rust host target.');
if (process.env.TAURI_ENV_TARGET_TRIPLE && process.env.TAURI_ENV_TARGET_TRIPLE !== target) throw new Error('Build on the target platform: bundled Node and CLIs must match the Rust target.');
await fs.mkdir(path.join(desktop,'binaries'),{recursive:true});
await fs.copyFile(process.execPath,path.join(desktop,'binaries',`node-${target}${process.platform==='win32'?'.exe':''}`));
const runtime=path.join(desktop,'runtime');
await fs.mkdir(runtime,{recursive:true});
await fs.writeFile(path.join(runtime,'.keep'),'');
if (!process.argv.includes('--dev')) {
  await prepareServices();
  const {build}=await import('vite');
  await build({root:appRoot});
  await fs.rm(runtime,{recursive:true,force:true});
  await fs.mkdir(runtime,{recursive:true});
  await fs.writeFile(path.join(runtime,'package.json'),JSON.stringify({private:true,type:'module'}));
  async function compile(directory) {
    for (const entry of await fs.readdir(path.join(appRoot,directory),{withFileTypes:true})) {
      const relative=path.join(directory,entry.name), source=path.join(appRoot,relative);
      if (entry.isDirectory()) {await compile(relative);continue;}
      const destination=path.join(runtime,relative.replace(/\.ts$/,'.js'));
      await fs.mkdir(path.dirname(destination),{recursive:true});
      if (entry.name.endsWith('.ts')) {
        const result=ts.transpileModule(await fs.readFile(source,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
        await fs.writeFile(destination,result.outputText);
      } else await fs.copyFile(source,destination);
    }
  }
  await compile('server'); await compile('shared');
  await fs.copyFile(path.join(appRoot,'LICENSE'),path.join(runtime,'LICENSE'));
  await fs.cp(path.join(appRoot,'dist'),path.join(runtime,'dist'),{recursive:true});
  for (const dependency of ['zod','playwright','playwright-core']) await fs.cp(path.join(appRoot,'node_modules',dependency),path.join(runtime,'node_modules',dependency),{recursive:true});
  await fs.cp(path.join(appRoot,'.studio-local/cli'),path.join(runtime,'tools'),{recursive:true,verbatimSymlinks:true});
  await fs.copyFile(path.join(appRoot,'cli-tools.json'),path.join(runtime,'cli-tools.json'));
}
console.log(`Desktop runtime prepared for ${target}.`);
