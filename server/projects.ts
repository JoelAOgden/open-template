import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { AppError, atomicWrite, checkedPath, ensureRoot, manifest, readSafe } from "./files.js";
import { Store } from "./store.js";
import { Studio } from "./studio.js";

const Catalog = z.object({ last: z.string().optional(), recent: z.array(z.object({path:z.string(),name:z.string(),openedAt:z.string()})) });
const inside = (parent:string, child:string) => child === parent || child.startsWith(parent + path.sep);
async function exists(file:string) { try {await fs.lstat(file);return true;}catch(e){if((e as NodeJS.ErrnoException).code === "ENOENT")return false;throw e;} }

export async function pickProjectFolder():Promise<string|null> {
  try {
    if(process.platform === "darwin") {
      const result=await promisify(execFile)("osascript",["-e",'POSIX path of (choose folder with prompt "Open an open-template folder")'],{timeout:300000,maxBuffer:16384});
      return result.stdout.trim() || null;
    }
    if(process.platform === "linux") {
      const result=await promisify(execFile)("zenity",["--file-selection","--directory","--title=Open an open-template folder"],{timeout:300000,maxBuffer:16384});
      return result.stdout.trim() || null;
    }
    throw new AppError("Native folder selection is unavailable here. Enter the folder path.");
  } catch(e) {
    const error=e as Error & {code?:number|string;stderr?:string};
    if(error.stderr?.includes("(-128)") || (process.platform === "linux" && error.code === 1))return null;
    throw new AppError("Could not open the native folder picker. Enter the folder path instead.");
  }
}

export class Projects {
  private catalog:z.infer<typeof Catalog>={recent:[]};
  readonly configDir:string;
  notice?:string;
  constructor(public appRoot:string, configDir=path.join(appRoot,".studio-local"),public picker=pickProjectFolder){this.configDir=configDir;}
  async init(){
    await ensureRoot(this.configDir);
    try{this.catalog=Catalog.parse(JSON.parse((await readSafe(this.configDir,"projects.json")).toString()));}
    catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
  }
  list(studio:Studio|null){return {current:studio ? {path:studio.store.root,name:studio.store.project.name} : null,recent:this.catalog.recent,notice:this.notice};}
  private async remember(store:Store){
    const entry={path:store.root,name:store.project.name,openedAt:new Date().toISOString()};
    const next={last:store.root,recent:[entry,...this.catalog.recent.filter(p=>p.path!==store.root)].slice(0,30)};
    await atomicWrite(this.configDir,"projects.json",JSON.stringify(next));this.catalog=next;
  }
  async validate(input:string){
    if(!path.isAbsolute(input) || /[\x00-\x1f]/.test(input))throw new AppError("Enter an absolute folder path.");
    let target=path.resolve(input);
    // Resolve the existing parent before creating a new project directory.
    let ancestor=target;const missing:string[]=[];
    while(!await exists(ancestor)){missing.unshift(path.basename(ancestor));const parent=path.dirname(ancestor);if(parent===ancestor)throw new AppError("Folder unavailable.");ancestor=parent;}
    if((await fs.lstat(ancestor)).isSymbolicLink())throw new AppError("Choose a real project folder, not a symbolic link.");
    target=path.join(await fs.realpath(ancestor),...missing);
    const app=await fs.realpath(this.appRoot),home=await fs.realpath(os.homedir());
    if(inside(target,app) || inside(target,home) || (inside(app,target)&&!inside(path.join(app,"projects"),target)) || target===path.join(app,"projects"))
      throw new AppError("Choose a project folder separate from open-template, your home folder and system roots.");
    if(target.split(path.sep).some(part=>[".git",".agents",".codex",".aws",".project-studio",".project-ide","node_modules"].includes(part)))throw new AppError("That folder is reserved for application data or dependencies.");
    if(inside(target,this.configDir)||inside(this.configDir,target))throw new AppError("Choose a folder outside machine settings.");
    for(const saved of this.catalog.recent){
      if(saved.path!==target && (inside(saved.path,target)||inside(target,saved.path)))throw new AppError("Projects cannot be nested inside another registered project.");
    }
    let parent=path.dirname(target);
    while(parent!==path.dirname(parent)){
      if(await exists(path.join(parent,".project-studio/project.json")))throw new AppError("Projects cannot be nested inside another project.");
      parent=path.dirname(parent);
    }
    if(await exists(target)){
      if(!(await fs.lstat(target)).isDirectory())throw new AppError("Select a directory.");
      const metadata=path.join(target,".project-studio");
      if(await exists(metadata)){
        await checkedPath(target,".project-studio");
        if(!await exists(path.join(metadata,"project.json")))throw new AppError("This folder has incomplete open-template metadata. Restore it before opening.",409);
      }
      await manifest(target,["AGENTS.md"]);
    }
    return target;
  }
  async open(studio:Studio,input:string,createNew=false){
    if(studio.busy)throw new AppError("Stop the current pipeline before switching projects.",409);
    const target=await this.validate(input);
    if(createNew && await exists(target))throw new AppError("That folder already exists. Choose another name or use Open existing.",409);
    if(target===studio.store.root)return {path:target};
    const store=new Store(target,"folder");
    await studio.switchProject(store);
    delete this.notice;
    try { await this.remember(store); } catch { this.notice="Project opened, but recent folders could not be saved. Reopen this folder manually after restarting open-template."; }
    return {path:target};
  }
  async initialStore(){
    if(this.catalog.last){
      try{
        const target=await this.validate(this.catalog.last);
        if(!await exists(path.join(target,".project-studio/project.json")))throw new Error("Saved project is unavailable");
        return new Store(target,"folder");
      }catch(e){this.notice=`The last folder could not be reopened: ${(e as Error).message}. Use Open existing to locate it.`;}
    }
    return null;
  }
  async opened(store:Store){await this.remember(store);}
  async start(input:string,createNew=false){
    const target=await this.validate(input);
    if(createNew && await exists(target))throw new AppError("That folder already exists. Choose another name or use Open existing.",409);
    const studio=new Studio(new Store(target,"folder"));
    try { await studio.init(); } catch(error) { await studio.close(); throw error; }
    delete this.notice;
    try { await this.remember(studio.store); } catch { this.notice="Project opened, but recent folders could not be saved."; }
    return studio;
  }
}
