export type RuntimePlatform = "macos" | "windows" | "linux";
export const launcherName = (platform: RuntimePlatform): "start.ps1" | "start.sh" => platform === "windows" ? "start.ps1" : "start.sh";
