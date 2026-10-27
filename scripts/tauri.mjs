import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
const args=process.argv.slice(2);
if(args[0]==='dev') args.push('--config','src-tauri/tauri.dev.conf.json');
let entry;
try {
  const manifest=require.resolve('@tauri-apps/cli/package.json');
  const pkg=JSON.parse(fs.readFileSync(manifest,'utf8'));
  entry=path.resolve(path.dirname(manifest),typeof pkg.bin==='string'?pkg.bin:pkg.bin.tauri);
} catch { /* npm can prepare the CLI in its cache on first use. */ }
let commandArgs;
if(entry) commandArgs=[entry,...args];
else {
  // npm run supplies this absolute JS entry point on both Windows and Unix.
  // Avoid spawning npm.cmd through a shell on Windows.
  const npm=process.env.npm_execpath;
  if(!npm || !path.isAbsolute(npm)) {
    console.error('Run this launcher with npm run desktop:dev or npm run desktop:build.');
    process.exit(1);
  }
  console.log('Preparing Tauri CLI through npm (the first run requires internet access)…');
  commandArgs=[npm,'exec','--yes','--package=@tauri-apps/cli@2','--','tauri',...args];
}
const child=spawn(process.execPath,commandArgs,{stdio:'inherit',shell:false});
child.on('error',error=>{console.error(`Cannot run Tauri: ${error.message}`);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
