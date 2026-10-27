type Session = { token: string; projectKey?: string; };
let ready: Promise<Session> | null = null;
let projectMismatch = false;
const projectChanged = "Project changed. Reload open-template before continuing; nothing was saved to the new project.";
function bootstrap() {
  if (!ready)
    ready = fetch("/api/bootstrap")
      .then(async (r) => {
        if (!r.ok) throw new Error("Cannot connect to the local service.");
        return await r.json() as Session;
      })
      .catch((e) => {
        ready = null;
        throw e;
      });
  return ready;
}
async function request(route: string, options: RequestInit = {}) {
  if (projectMismatch) throw new Error(projectChanged);
  const session = bootstrap();
  const send = async ({ token, projectKey }: Session) => {
    const headers = new Headers(options.headers);
    headers.set("X-Studio-Token", token);
    if (projectKey) headers.set("X-Studio-Project", projectKey);
    return fetch(`/api${route}`, { ...options, headers });
  };
  let response = await send(await session);
  if (response.status === 403) {
    const data = await response
      .clone()
      .json()
      .catch(() => null);
    if (
      data?.error ===
      "Missing or invalid local session token. Reload open-template."
    ) {
      // Token validation rejects the request before any operation runs. Retry
      // only this rejection, once; never replay an ambiguous network failure.
      if (ready === session) ready = null;
      const next = await bootstrap(), previous = await session;
      if (previous.projectKey && previous.projectKey !== next.projectKey) { projectMismatch = true; throw new Error(projectChanged); }
      response = await send(next);
    }
  }
  if (response.status === 409) {
    const data = await response.clone().json().catch(() => null);
    if (data?.error === projectChanged) projectMismatch = true;
  }
  return response;
}
export async function api<T>(
  route: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const response = await request(route, {
    method: body === undefined ? "GET" : method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    if (
      response.status === 404 &&
      ["API route not found.", "Endpoint not found."].includes(data.error)
    )
      throw new Error(
        "This action is unavailable on the running server. Restart open-template and try again.",
      );
    throw new Error(data.error ?? "Request failed.");
  }
  return data;
}
export async function assetUrl(assetId: string) {
  const r = await request(`/assets/${assetId}`);
  if (!r.ok) throw new Error("Image unavailable.");
  return URL.createObjectURL(await r.blob());
}
