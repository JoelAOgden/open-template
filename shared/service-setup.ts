import type { Provider } from "./agent-settings.js";

export type ServiceStatus = {
  provider: Provider;
  installed: boolean;
  version?: string;
  auth: "signed-in" | "signed-out" | "unknown";
  message: string;
};
export type ServiceSetupAction = "login";
