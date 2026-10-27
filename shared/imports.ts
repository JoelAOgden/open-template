import type { Document, Project } from "./model";

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg"];
export const TEXT_EXTENSIONS = [
  "txt",
  "text",
  "md",
  "markdown",
  "mdx",
  "log",
  "csv",
  "tsv",
  "json",
  "jsonl",
  "yaml",
  "yml",
  "toml",
  "xml",
  "html",
  "htm",
  "css",
  "scss",
  "less",
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "rb",
  "rs",
  "go",
  "java",
  "c",
  "h",
  "cpp",
  "hpp",
  "sh",
  "sql",
  "ini",
  "cfg",
  "conf",
  "properties",
];
export const IMAGE_ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,image/svg+xml,.svg";
export const IMPORT_ACCEPT = [
  IMAGE_ACCEPT,
  "text/*",
  "application/json",
  ...TEXT_EXTENSIONS.map((ext) => `.${ext}`),
].join(",");
export type ImportTarget = { kind: "section" | "document"; id: string };
export type ImportResolution =
  | { action: "replace"; documentId: string; version: number }
  | { action: "keep_both" };
export type ImportFile = {
  name: string;
  base64: string;
  resolution?: ImportResolution;
};
export type ImportResult = { project: Project; documents: Document[] };

export const importNameKey = (name: string) => name.normalize("NFC").trim().toLowerCase();
