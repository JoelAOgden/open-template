import { ServiceSetup } from "./service-setup.js";
import { ProviderSchema } from "../shared/agent-settings.js";
import type { Projects } from "./projects.js";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import { cachedModels } from "./agent-settings.js";
import { debugFiles } from "./debug.js";
import path from "node:path";
import { z } from "zod";
import { Studio } from "./studio.js";
import { AppError, fileTree, isBinary, readSafe } from "./files.js";

export function validateRequest(
  req: IncomingMessage,
  port: number,
  token: string,
) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!req.headers.host || !hosts.has(req.headers.host))
    throw new AppError("Untrusted Host.", 403);
  const origin = req.headers.origin;
  if (origin && ![...hosts].map((h) => `http://${h}`).includes(origin))
    throw new AppError("Untrusted Origin.", 403);
  if (req.headers["sec-fetch-site"] === "cross-site")
    throw new AppError("Cross-site requests are blocked.", 403);
  if (req.url?.startsWith("/api/") && req.url !== "/api/bootstrap") {
    const provided = req.headers["x-studio-token"];
    if (
      typeof provided !== "string" ||
      !/^[a-f0-9]{64}$/.test(provided) ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(token))
    )
      throw new AppError(
        "Missing or invalid local session token. Reload open-template.",
        403,
      );
  }
  if (
    req.method !== "GET" &&
    req.method !== "HEAD" &&
    req.headers["content-type"] !== "application/json"
  )
    throw new AppError("Mutations require application/json.", 415);
}
async function body(req: IncomingMessage, limit = 8 * 1024 * 1024) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new AppError("Request exceeds 8 MB.", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    throw new AppError("Invalid JSON body.");
  }
}
export function createHttpServer(
  activeStudio: Studio | null,
  appRoot: string,
  options: { dev?: boolean; projects?: Projects; services?: ServiceSetup; desktopClose?: () => void } = {},
) {
  const services = options.services ?? new ServiceSetup(appRoot);
  const token = randomBytes(32).toString("hex");
  let vite: import("vite").ViteDevServer | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  let definitionQueue: Promise<unknown> = Promise.resolve();
  const attach = (studio: Studio) => { studio.workflows.mutateDefinitions = operation => {
    const result = definitionQueue.then(operation);
    definitionQueue = result.catch(() => {}); return result;
  };
  };
  if (activeStudio) attach(activeStudio);
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self'${options.dev ? " 'unsafe-inline'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'${options.dev ? " ws://127.0.0.1:* ws://localhost:*" : ""}; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'`,
    );
    try {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 4310;
      validateRequest(req, port, token);
      const url = new URL(req.url!, `http://127.0.0.1:${port}`);
      const send = (value: unknown, status = 200) => {
        if(options.projects && req.method === "GET" && url.pathname.startsWith("/api/") && url.pathname !== "/api/bootstrap")assertProject();
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (url.pathname === "/api/bootstrap" && req.method === "GET") {
        send({ token, ...(options.projects ? {projectKey:activeStudio?.workspaceKey} : {}) });
        return;
      }
      const assertProject = () => {
        if(options.projects && req.headers["x-studio-project"] !== activeStudio?.workspaceKey)
          throw new AppError("Project changed. Reload open-template before continuing; nothing was saved to the new project.",409);
      };
      if (url.pathname.startsWith("/api/")) {
        assertProject();
        if (url.pathname === "/api/projects" && req.method === "GET" && options.projects) {
          send(options.projects.list(activeStudio)); return;
        }
        if (!activeStudio) {
          if (req.method === "POST") {
            const input = await body(req);
            const handle = async () => {
              assertProject();
              if (url.pathname === "/api/desktop/close" && options.desktopClose) {
                z.object({}).strict().parse(input); setTimeout(options.desktopClose,100); return {};
              }
              if (url.pathname === "/api/projects/pick" && options.projects) {
                z.object({}).strict().parse(input); return {path:await options.projects.picker()};
              }
              if (["/api/projects/open", "/api/projects/new"].includes(url.pathname) && options.projects) {
                const value=z.object({path:z.string().trim().min(1).max(4096)}).strict().parse(input);
                activeStudio=await options.projects.start(value.path,url.pathname === "/api/projects/new");
                attach(activeStudio); return {path:activeStudio.store.root};
              }
              throw new AppError("Create or open a project before continuing.",409);
            };
            const result=queue.then(handle); queue=result.catch(()=>{}); send(await result); return;
          }
          throw new AppError("Create or open a project before continuing.",409);
        }
        const studio = activeStudio;
        if (req.method === "GET") {
          if (url.pathname === "/api/services/status") {
            send(await services.status(ProviderSchema.parse(url.searchParams.get("provider")))); return;
          }
          if (url.pathname === "/api/workflows") { send(await studio.workflows.list()); return; }
          const workflowRoute = /^\/api\/workflows\/([^/]+)(?:\/(file|events))?$/.exec(url.pathname);
          if (workflowRoute) {
            const [, id, action] = workflowRoute;
            if (action === "file") send(await studio.workflows.file(id, z.string().min(1).parse(url.searchParams.get("path"))));
            else if (action === "events") send(await studio.workflows.events(id, z.string().parse(url.searchParams.get("stage")), z.coerce.number().int().positive().parse(url.searchParams.get("attempt")), z.coerce.number().int().nonnegative().parse(url.searchParams.get("offset") ?? 0)));
            else send(studio.workflows.view(await studio.workflows.get(id)));
            return;
          }

          if (
            url.pathname === "/api/debug/files" ||
            url.pathname === "/api/debug/file"
          ) {
            const scope = z
              .enum(["current", "plan"])
              .parse(url.searchParams.get("scope") ?? "current");
            const file =
              url.pathname === "/api/debug/file"
                ? z.string().min(1).parse(url.searchParams.get("path"))
                : undefined;
            send(await debugFiles(studio.store, studio.session, scope, file));
            return;
          }
          if (url.pathname === "/api/state") {
            send(await studio.state());
            return;
          }
          if (url.pathname === "/api/pipelines") {
            send(await studio.pipelines.list());
            return;
          }
          if (url.pathname.startsWith("/api/pipelines/")) {
            const parts = url.pathname.slice("/api/pipelines/".length).split("/");
            if (parts.length === 1) {
              const pipeline = await studio.pipelines.get(parts[0]);
              // Raw chunks and exact per-call inputs load on demand, not in polling.
              send({ ...pipeline, units: pipeline.units.map(({ content: _content, ...unit }) => unit) });
              return;
            }
            if (parts.length === 3 && parts[1] === "steps") {
              send(await studio.pipelines.step(parts[0], parts[2]));
              return;
            }
            throw new AppError("Pipeline route not found.", 404);
          }
          if (url.pathname === "/api/models") {
            send(await cachedModels());
            return;
          }
          if (url.pathname === "/api/tree") {
            send(fileTree(await studio.store.projectManifest()));
            return;
          }
          if (url.pathname === "/api/runs") {
            send(await studio.store.runs());
            return;
          }
          if (url.pathname.startsWith("/api/runs/")) {
            const id = url.pathname.slice("/api/runs/".length);
            send(
              studio.run?.id === id ? studio.run : await studio.store.run(id),
            );
            return;
          }
          if (url.pathname === "/api/prompts") {
            send(await studio.store.prompts());
            return;
          }
          if (url.pathname.startsWith("/api/prompts/")) {
            send(
              await studio.store.prompt(
                url.pathname.slice("/api/prompts/".length),
              ),
            );
            return;
          }
          if (url.pathname === "/api/file") {
            const data = await readSafe(
              studio.store.codeDir,
              url.searchParams.get("path") ?? "",
              true,
            );
            send({
              text: isBinary(data) ? null : data.toString(),
              binary: isBinary(data),
              size: data.length,
            });
            return;
          }
          if (url.pathname.startsWith("/api/assets/")) {
            const asset = url.pathname.slice("/api/assets/".length);
            if (!/^[a-f0-9]{64}\.(png|jpg|gif|webp|svg)$/.test(asset))
              throw new AppError("Invalid asset.");
            const data = await readSafe(
              studio.store.dataDir,
              `assets/${asset}`,
              false,
              Infinity,
            );
            assertProject();
            if (asset.endsWith(".svg"))
              res.setHeader(
                "Content-Security-Policy",
                "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'",
              );
            res.writeHead(200, {
              "Content-Type": asset.endsWith(".svg")
                ? "image/svg+xml"
                : `image/${asset.endsWith(".jpg") ? "jpeg" : asset.split(".").at(-1)}`,
            });
            res.end(data);
            return;
          }
          if (url.pathname.startsWith("/api/skills/")) {
            const slug = url.pathname.slice("/api/skills/".length);
            if (!studio.store.project.sections.some((s) => s.slug === slug))
              throw new AppError("Skill not found.", 404);
            send({
              text: (
                await readSafe(studio.store.skillDir, `skills/${slug}/SKILL.md`)
              ).toString(),
            });
            return;
          }
        } else if (
          req.method === "POST" ||
          req.method === "PUT" ||
          req.method === "DELETE"
        ) {
          // Imports and subsequent edits/deletions must support the same amount
          // of content. Keep command endpoints' existing request bound.
          const definitionContent =
            url.pathname === "/api/definition-import" ||
            url.pathname === "/api/assets" ||
            url.pathname.startsWith("/api/documents/") ||
            url.pathname.startsWith("/api/sections/");
          const input: unknown = await body(
            req,
            definitionContent ? Infinity : undefined,
          );
          const handle = async () => {
            assertProject();
            if (req.method === "POST" && url.pathname === "/api/desktop/close" && options.desktopClose) {
              z.object({}).strict().parse(input);
              await studio.close();
              setTimeout(options.desktopClose,100);
              return {};
            }
            if (req.method === "POST" && url.pathname === "/api/services/setup") {
              const value = z.object({provider:ProviderSchema,action:z.literal("login")}).strict().parse(input);
              if (studio.busy) throw new AppError("Stop the pipeline before changing service setup.",409);
              return services.launch(value.provider, value.action);
            }
            if(options.projects && req.method === "POST" && url.pathname === "/api/projects/pick") {
              z.object({}).strict().parse(input);
              if(studio.busy)throw new AppError("Stop the current pipeline before opening another project.",409);
              return {path:await options.projects.picker()};
            }
            if(options.projects && req.method === "POST" && ["/api/projects/open", "/api/projects/new"].includes(url.pathname)) {
              const value=z.object({path:z.string().trim().min(1).max(4096)}).strict().parse(input);
              return options.projects.open(studio,value.path,url.pathname === "/api/projects/new");
            }
            if (req.method === "POST" && url.pathname === "/api/workflows") {
              const options = z.object({ fullSpec: z.boolean(), source: z.enum(["project", "saved-draft"]) }).strict().parse(input);
              await studio.stopProject();
              return studio.workflows.create({...options,acceptancePolicy:"automatic"});
            }
            const workflowAction = /^\/api\/workflows\/([^/]+)\/(resume|stop|accept|dismiss|cancel|rollback|retry-apply)$/.exec(url.pathname);
            if (req.method === "POST" && workflowAction) {
              const [, id, action] = workflowAction;
              z.string().uuid().parse(id);
              if (studio.workflows.active?.id !== id) throw new AppError("Only the active run can be changed.", 409);
              if (action === "resume") {
                const value = z.object({ message: z.string().default(""), fresh: z.boolean().default(false) }).strict().parse(input);
                await studio.stopProject(); await studio.workflows.resume(id, value.message, value.fresh);
              } else {
                z.object({}).strict().parse(input);
                if (action === "retry-apply") {await studio.stopProject();await studio.workflows.retryApply(id);}
                if (action === "rollback") {await studio.stopProject();await studio.workflows.rollback(id);}
                if (action === "cancel") await studio.workflows.cancel(id);
                if (action === "stop") await studio.workflows.stop();
                if (action === "dismiss") await studio.workflows.dismiss(id);
                if (action === "accept") { await studio.stopProject(); await studio.workflows.accept(id); }
              }
              return {};
            }

            if (url.pathname === "/api/settings" && req.method === "POST")
              return studio.updateSettings(input);
            if (req.method === "DELETE") {
              if (url.pathname.startsWith("/api/documents/")) {
                const id = z
                  .string()
                  .uuid()
                  .parse(url.pathname.slice("/api/documents/".length));
                const value = z
                  .object({ version: z.number().int().nonnegative() })
                  .strict()
                  .parse(input);
                return studio.store.deleteDocument(id, value.version);
              }
              if (url.pathname.startsWith("/api/sections/")) {
                const id = z
                  .string()
                  .uuid()
                  .parse(url.pathname.slice("/api/sections/".length));
                const value = z
                  .object({
                    documents: z.array(
                      z
                        .object({
                          id: z.string().uuid(),
                          version: z.number().int().nonnegative(),
                        })
                        .strict(),
                    ),
                  })
                  .strict()
                  .parse(input);
                return studio.store.deleteSection(id, value.documents);
              }
              throw new AppError("Endpoint not found.", 404);
            }
            if (url.pathname === "/api/sections" && req.method === "POST")
              return studio.store.addSection(
                z
                  .object({ name: z.string().trim().min(1).max(70) })
                  .strict()
                  .parse(input).name,
              );
            if (
              url.pathname === "/api/definition-import" &&
              req.method === "POST"
            )
              return studio.store.importFiles(input);
            if (url.pathname === "/api/documents" && req.method === "POST") {
              const v = z
                .object({
                  sectionId: z.string(),
                  title: z.string().trim().min(1).max(200),
                })
                .strict()
                .parse(input);
              return studio.store.addDocument(v.sectionId, v.title);
            }
            if (
              url.pathname.startsWith("/api/documents/") &&
              req.method === "PUT"
            )
              return studio.store.saveDocument(
                url.pathname.slice("/api/documents/".length),
                input,
              );
            if (url.pathname === "/api/project") {
              const v = z
                .object({ name: z.string().trim().min(1).max(80) })
                .strict()
                .parse(input);
              studio.store.project.name = v.name;
              await studio.store.saveProject();
              return {};
            }
            if (url.pathname === "/api/assets")
              return {
                assetId: await studio.store.saveImage(
                  z.object({ base64: z.string() }).strict().parse(input).base64,
                ),
              };
            if (url.pathname === "/api/start") {
              if (studio.busy)
                throw new AppError(
                  "Wait for the preview to finish starting.",
                  409,
                );
              await studio.startProject(
                z
                  .object({ scriptHash: z.string().length(64) })
                  .strict()
                  .parse(input).scriptHash,
              );
              return {};
            }
            if (url.pathname === "/api/stop") {
              await studio.stopProject();
              return {};
            }
            throw new AppError("API route not found.", 404);
          };
          // Serialize workspace mutations.
          const definitionMutation = definitionContent || ["/api/sections", "/api/documents", "/api/project"].includes(url.pathname);
          const result = queue.then(() => definitionMutation ? studio.workflows.mutateDefinitions(handle) : handle());
          queue = result.catch(() => {});
          send(await result);
          return;
        }
        throw new AppError("API route not found.", 404);
      }
      if (req.method !== "GET" && req.method !== "HEAD")
        throw new AppError("Method not allowed.", 405);
      // Explicit frontend allowlist: never serve definitions, credentials, or generated code.
      if (options.dev && vite) {
        if (
          !/^\/(?:$|index\.html$|src\/|shared\/|@vite\/|@react-refresh$|@fs\/.*\/node_modules\/|node_modules\/vite\/dist\/client\/env\.mjs$|node_modules\/\.vite\/deps\/)/.test(
            url.pathname,
          ) ||
          /(?:^|\/)\.{1,2}(?:\/|$)/.test(decodeURIComponent(url.pathname))
        )
          throw new AppError("Not found.", 404);
        vite.middlewares(req, res, () => {
          res.writeHead(404);
          res.end("Not found");
        });
        return;
      }
      if (
        url.pathname !== "/" &&
        url.pathname !== "/index.html" &&
        !/^\/assets\/[\w.-]+\.(js|css)$/.test(url.pathname)
      )
        throw new AppError("Not found.", 404);
      const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const data = await fs.readFile(path.join(appRoot, "dist", file));
      res.writeHead(200, {
        "Content-Type": file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "text/html",
      });
      res.end(data);
    } catch (e) {
      respondError(res, e);
    }
  });
  return {
    server,
    async listen(port: number) {
      if (options.dev) {
        const { createServer: createVite } = await import("vite");
        vite = await createVite({
          root: appRoot,
          configLoader: "runner",
          server: { middlewareMode: true, hmr: { server }, host: "127.0.0.1" },
          appType: "spa",
        });
      }
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
      });
      return (server.address() as { port: number }).port;
    },
    async close() {
      await activeStudio?.close();
      await vite?.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
function respondError(res: ServerResponse, e: unknown) {
  const error = e as Error & { code?: string };
  const status =
    e instanceof AppError
      ? e.status
      : e instanceof z.ZodError
        ? 400
        : error.code === "ENOENT"
          ? 404
          : 500;
  const message =
    e instanceof z.ZodError
      ? `Invalid data: ${e.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`
      : status === 500
        ? "Local operation failed. Check the server terminal."
        : error.message;
  if (status === 500) console.error(error);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}
