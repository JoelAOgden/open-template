import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { z } from "zod";

// Private, inherited stdin/stdout protocol. Never expose arbitrary native commands
// or credentials to the webview. Ordinary application logs belong on stderr.
export class DesktopBridge {
  private requests = new Map<string, {resolve:(value:string|null)=>void;reject:(error:Error)=>void}>();
  constructor(private input: NodeJS.ReadableStream, private output: NodeJS.WritableStream,
    private shutdown: () => Promise<void>) {}
  listen() {
    const lines = createInterface({input:this.input});
    lines.on("line",line=>{
      try {
        const message = JSON.parse(line);
        if (message.type === "shutdown") { void this.shutdown(); return; }
        const reply = z.object({type:z.literal("folder-result"),id:z.string().uuid(),path:z.string().nullable()}).parse(message);
        this.requests.get(reply.id)?.resolve(reply.path); this.requests.delete(reply.id);
      } catch { /* Unknown native messages do not execute anything. */ }
    });
    lines.on("close",()=>{for(const request of this.requests.values())request.reject(new Error("Desktop host closed."));this.requests.clear();void this.shutdown();});
  }
  send(message: object) { this.output.write(JSON.stringify(message)+"\n"); }
  pickFolder() {
    const id=randomUUID();
    return new Promise<string|null>((resolve,reject)=>{this.requests.set(id,{resolve,reject});this.send({type:"pick-folder",id});});
  }
  close() { this.send({type:"close-approved"}); }
}
