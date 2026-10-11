/**
 * VEN-3: the Vercel REST API, for attaching a venue's domain to this project.
 *
 * Switched on by `VERCEL_API_TOKEN`. The project is the one Vercel says this
 * deployment belongs to (`VERCEL_PROJECT_ID`, a system variable on Vercel),
 * and `VERCEL_TEAM_ID` scopes the calls when the project lives in a team.
 */

const API = "https://api.vercel.com";

export function isDomainsConfigured(): boolean {
  return Boolean(process.env.VERCEL_API_TOKEN && process.env.VERCEL_PROJECT_ID);
}

export class VercelError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "VercelError";
  }
}

interface Options {
  fetchImpl?: typeof fetch;
}

async function call<T>(path: string, init: RequestInit = {}, options: Options = {}): Promise<T> {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) throw new VercelError("Vercel is not configured", 0, null);
  const url = new URL(`${API}${path}`);
  if (process.env.VERCEL_TEAM_ID) url.searchParams.set("teamId", process.env.VERCEL_TEAM_ID);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new VercelError(`Vercel unreachable: ${error instanceof Error ? error.message : String(error)}`, 0, null);
  }
  const body = (await response.json().catch(() => null)) as (T & { error?: { code?: string; message?: string } }) | null;
  if (!response.ok || !body) {
    throw new VercelError(body?.error?.message ?? `HTTP ${response.status}`, response.status, body?.error?.code ?? null);
  }
  return body;
}

const project = () => encodeURIComponent(process.env.VERCEL_PROJECT_ID ?? "");

export interface ProjectDomain {
  name: string;
  apexName: string;
  verified: boolean;
  verification?: Array<{ type: string; domain: string; value: string; reason: string }>;
}

export function addProjectDomain(name: string, options: Options = {}): Promise<ProjectDomain> {
  return call<ProjectDomain>(`/v10/projects/${project()}/domains`, { method: "POST", body: JSON.stringify({ name }) }, options);
}

export function getProjectDomain(name: string, options: Options = {}): Promise<ProjectDomain> {
  return call<ProjectDomain>(`/v9/projects/${project()}/domains/${encodeURIComponent(name)}`, {}, options);
}

export function verifyProjectDomain(name: string, options: Options = {}): Promise<ProjectDomain> {
  return call<ProjectDomain>(`/v9/projects/${project()}/domains/${encodeURIComponent(name)}/verify`, { method: "POST" }, options);
}

/** Removes it from the project. One already gone is done. */
export async function removeProjectDomain(name: string, options: Options = {}): Promise<void> {
  try {
    await call(`/v9/projects/${project()}/domains/${encodeURIComponent(name)}`, { method: "DELETE" }, options);
  } catch (error) {
    if (error instanceof VercelError && error.status === 404) return;
    throw error;
  }
}

export interface DomainConfig {
  misconfigured: boolean;
  configuredBy: "A" | "CNAME" | "dns-01" | "http" | null;
  recommendedCNAME: Array<{ rank: number; value: string }>;
  recommendedIPv4: Array<{ rank: number; value: string[] }>;
}

export function getDomainConfig(name: string, options: Options = {}): Promise<DomainConfig> {
  const query = `projectIdOrName=${project()}`;
  return call<DomainConfig>(`/v6/domains/${encodeURIComponent(name)}/config?${query}`, {}, options);
}
