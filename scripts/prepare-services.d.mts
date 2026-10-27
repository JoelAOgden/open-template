export type ServiceTool = { package: string; version: string; label: string };
export const appRoot: string;
export function serviceReady(root: string, provider: string, tool: ServiceTool): Promise<boolean>;
export function installArguments(root: string, provider: string, tool: ServiceTool): string[];
export function prepareServices(options?: {
  root?: string;
  install?: (args: string[], root: string) => Promise<void>;
  log?: (message: string) => void;
}): Promise<void>;
