import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { identify, IdentifyOptions, Identity, optionsFromEnv } from "@synergy/identity";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      identity?: Identity;
      userEmail?: string;
    }
  }
}

/** Wrap an async route so a rejected promise reaches the error handler. */
export const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/**
 * Require a signed-in user. Sets req.identity and req.userEmail, or answers 401.
 * `devQueryParam` lets local dev simulate users per browser tab (e.g. ?as=bob@x.com).
 */
export function requireUser(opts: { identify?: IdentifyOptions; devQueryParam?: string } = {}): RequestHandler {
  const base = opts.identify ?? optionsFromEnv();
  return (req, res, next) => {
    const devOverride = opts.devQueryParam ? String(req.query[opts.devQueryParam] ?? "") || null : null;
    const who = identify(req.headers, { ...base, devOverride });
    if (!who) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    req.identity = who;
    req.userEmail = who.email;
    next();
  };
}

/** Machine-to-machine routes: `Authorization: Bearer <token>`, compared in constant time. */
export function requireBearer(token: string): RequestHandler {
  return (req, res, next) => {
    const given = Buffer.from(String(req.headers.authorization ?? ""));
    const expected = Buffer.from(`Bearer ${token}`);
    if (!token || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      res.status(401).json({ error: "bad token" });
      return;
    }
    next();
  };
}

/** JSON body parsing, trust-proxy and /healthz: the same base every suite app starts from. */
export function baseApp(app: Express, express: { json(o: { limit: string }): RequestHandler }, jsonLimit = "256kb") {
  app.set("trust proxy", true);
  app.use(express.json({ limit: jsonLimit }));
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });
}

/** Answer errors as JSON: 4xx messages pass through, 5xx details are hidden in production. */
export function errorHandler(appName: string) {
  return (err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    // Errors thrown with a 4xx status (e.g. bad input) are the caller's fault: pass the message on.
    const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status >= 500) console.error(`[${appName}]`, err);
    const hide = status >= 500 && process.env.NODE_ENV === "production";
    res.status(status).json({ error: hide ? "internal error" : String(err.message || "internal error").slice(0, 300) });
  };
}

const escAttr = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * The suite header (<synergy-app-bar>) injected at the top of an app's page, plus the
 * layout fix that makes room for it: apps size #root to 100% of the body, so the body
 * becomes a column and #root takes whatever height is left under the bar.
 */
export function appBarHtml(appId: string, user: string, domain: string): string {
  return (
    `<style>body{display:flex;flex-direction:column}body>#root{flex:1 1 auto;min-height:0;height:auto}</style>` +
    `<synergy-app-bar app="${escAttr(appId)}" user="${escAttr(user)}"${domain ? ` domain="${escAttr(domain)}"` : ""}></synergy-app-bar>` +
    `<script type="module" src="/_suite/app-bar.js"></script>`
  );
}

/**
 * Serve a built single-page app, falling back to index.html for client-side routes.
 * With `appId`, every page gets the suite header with the app launcher and signed-in user.
 */
export function serveSpa(
  app: Express,
  express: { static(root: string, opts?: { index?: boolean }): RequestHandler },
  distDir: string,
  opts: { appId?: string; identify?: IdentifyOptions } = {},
) {
  if (!opts.appId) {
    app.use(express.static(distDir));
    app.get("*", (_req, res) => res.sendFile(path.join(distDir, "index.html")));
    return;
  }
  const appId = opts.appId;
  const idOpts = opts.identify ?? optionsFromEnv();
  const barScript = require.resolve("@synergy/shell/app-bar.js");
  app.get("/_suite/app-bar.js", (_req, res) => {
    res.type("application/javascript").sendFile(barScript);
  });
  // index.html is read on first request, not at startup, so a server can boot before the web build exists.
  let indexHtml: string | null = null;
  const sendIndex: RequestHandler = (req, res) => {
    indexHtml ??= readFileSync(path.join(distDir, "index.html"), "utf8");
    const user = identify(req.headers, idOpts)?.email ?? "";
    const bar = appBarHtml(appId, user, process.env.SUITE_DOMAIN ?? "");
    res.type("html").set("Cache-Control", "no-store").send(indexHtml.replace(/<body([^>]*)>/i, (m) => m + bar));
  };
  app.get("/", sendIndex);
  app.use(express.static(distDir, { index: false }));
  app.get("*", sendIndex);
}
