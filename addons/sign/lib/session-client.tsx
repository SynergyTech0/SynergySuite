"use client";

import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";
import type { SessionUser } from "@/lib/auth";

/**
 * The browser side of the suite sign-in, shaped like next-auth's `useSession` so pages read the
 * same as before. The data comes from /api/me, which reads the gateway's headers.
 */
export type ClientSession = { user: SessionUser; signOutUrl: string; billing: boolean };
type State = { data: ClientSession | null; status: "loading" | "authenticated" | "unauthenticated" };

const Ctx = createContext<State>({ data: null, status: "loading" });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ data: null, status: "loading" });
  useEffect(() => {
    let live = true;
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ClientSession | null) => live && setState(d?.user ? { data: d, status: "authenticated" } : { data: null, status: "unauthenticated" }))
      .catch(() => live && setState({ data: null, status: "unauthenticated" }));
    return () => {
      live = false;
    };
  }, []);
  return createElement(Ctx.Provider, { value: state }, children);
}

export function useSession(): State & { update: () => Promise<void> } {
  return { ...useContext(Ctx), update: async () => window.location.reload() };
}

/** Goes to the suite sign-in and back to `callbackUrl` (or the current page). */
export function signIn(_provider?: string, opts: { callbackUrl?: string } = {}): Promise<void> {
  const back = opts.callbackUrl || window.location.pathname + window.location.search;
  window.location.href = `/signin?rd=${encodeURIComponent(back)}`;
  return Promise.resolve();
}

/** Signs out of the whole suite (there is no Sign-only session to end). */
export function signOut(_opts: { callbackUrl?: string; redirect?: boolean } = {}): Promise<void> {
  window.location.href = "/signout";
  return Promise.resolve();
}
