import { spawn, type ChildProcess } from "node:child_process";

export function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA,
    TEMP: process.env.TEMP, TMP: process.env.TMP,
    ...(process.env.OPEN_TEMPLATE_TOOLS_DIR ? { OPEN_TEMPLATE_TOOLS_DIR: process.env.OPEN_TEMPLATE_TOOLS_DIR } : {}),
    ...(process.env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH } : {}),
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    LANG: "en_US.UTF-8",
    TERM: "dumb",
    NO_COLOR: "1",
  };
  return env;
}
export function terminateTree(
  child: ChildProcess,
  signal: NodeJS.Signals = "SIGTERM",
) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    // Windows has no Unix process groups. Stop the foreground process and its
    // descendants; the desktop host additionally owns a kill-on-close Job.
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {shell:false, windowsHide:true, stdio:"ignore"});
    killer.on("error", () => { try { child.kill(); } catch { /* already gone */ } });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ESRCH") child.kill(signal);
  }
}
export const stripAnsi = (s: string) =>
  s
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
export function appendLog(logs: string[], line: string) {
  for (const l of stripAnsi(line).split("\n").filter(Boolean))
    logs.push(l.slice(0, 2000));
  if (logs.length > 300) logs.splice(0, logs.length - 300);
}
