import appsJson from "../apps.json";

export type SuiteApp = {
  id: string;
  name: string;
  /** The Microsoft 365 product this app stands in for. */
  m365: string;
  /** Default local port. Unique across the suite so every app can run side by side. */
  port: number;
  icon: string;
  /** Path of the app inside the monorepo. */
  dir: string;
  /** Core suite app (true) or optional add-on (false). */
  core: boolean;
  /** Listed in the launcher but not built yet. */
  planned?: boolean;
};

export const apps: readonly SuiteApp[] = appsJson as SuiteApp[];

export function getApp(id: string): SuiteApp {
  const app = apps.find((a) => a.id === id);
  if (!app) throw new Error(`unknown suite app "${id}"`);
  return app;
}

/** The port an app should listen on: $PORT when set, otherwise its default from the registry. */
export function portFor(id: string, env: NodeJS.ProcessEnv = process.env): number {
  const fromEnv = Number(env.PORT);
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : getApp(id).port;
}

/**
 * Public URL of an app. With SUITE_DOMAIN=example.com every app lives at
 * https://<id>.example.com; without it, apps are on localhost at their default port.
 */
export function appUrl(id: string, env: NodeJS.ProcessEnv = process.env): string {
  const app = getApp(id);
  const domain = env.SUITE_DOMAIN;
  return domain ? `https://${app.id}.${domain}` : `http://localhost:${app.port}`;
}

type EnvOptions = { default?: string; required?: boolean };

/**
 * Read an environment variable. `required` variables throw at startup when missing,
 * but only in production, so local development keeps working with defaults.
 */
export function env(name: string, opts: EnvOptions = {}, source: NodeJS.ProcessEnv = process.env): string {
  const value = source[name];
  if (value !== undefined && value !== "") return value;
  if (opts.required && source.NODE_ENV === "production") {
    throw new Error(`missing required environment variable ${name}`);
  }
  return opts.default ?? "";
}

export const isProduction = (source: NodeJS.ProcessEnv = process.env) => source.NODE_ENV === "production";
