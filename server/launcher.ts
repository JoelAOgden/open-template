import path from "node:path";
import { launcherName, type RuntimePlatform } from "../shared/runtime-platform.js";
export const hostPlatform = (platform: NodeJS.Platform = process.platform): RuntimePlatform => platform === "win32" ? "windows" : platform === "darwin" ? "macos" : "linux";
// Failing, language-neutral launchers; only the AI implements project startup.
export const START_STUB = '#!/bin/sh\necho "Project startup has not been implemented." >&2\nexit 1\n';
export const POWERSHELL_START_STUB = '$ErrorActionPreference = "Stop"\n[Console]::Error.WriteLine("Project startup has not been implemented.")\nexit 1\n';
export function launcher(platform = hostPlatform()) {
  return { filename: launcherName(platform), stub: platform === "windows" ? POWERSHELL_START_STUB : START_STUB,
    command: platform === "windows" ? "powershell -File .\\start.ps1" : "sh ./start.sh",
    binary: platform === "windows" ? path.win32.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "/bin/sh",
    args: platform === "windows" ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ".\\start.ps1"] : ["./start.sh"] };
}
export function launcherGuidance(platform = hostPlatform()) {
  return platform === "windows"
    ? "Target Windows. Implement the pre-created start.ps1 using Windows PowerShell 5.1-compatible syntax and Windows paths/commands. Keep the program in the foreground, propagate native exit codes, and do not use Start-Process to detach it. Preserve any existing start.sh."
    : `Target ${platform === "macos" ? "macOS" : "Linux"}. Implement the pre-created start.sh using POSIX shell and platform-appropriate paths/commands. Keep the program in the foreground, preferably using exec. Preserve any existing start.ps1.`;
}
