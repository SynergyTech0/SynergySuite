"use client";
import { useEffect, useState } from "react";
import type { Session } from "./session";

type State = {
  data: Session | null;
  status: "loading" | "authenticated" | "unauthenticated";
  ssoAvailable: boolean;
};

/** Who is using this page: a signed-in staff member, or a guest. */
export function useSession(): State {
  const [state, setState] = useState<State>({ data: null, status: "loading", ssoAvailable: false });
  useEffect(() => {
    let live = true;
    fetch("/api/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((b: { session: Session | null; ssoAvailable: boolean }) => {
        if (live) setState({ data: b.session, status: b.session ? "authenticated" : "unauthenticated", ssoAvailable: b.ssoAvailable });
      })
      .catch(() => live && setState({ data: null, status: "unauthenticated", ssoAvailable: false }));
    return () => { live = false; };
  }, []);
  return state;
}

export function signIn(callbackUrl = window.location.pathname) {
  window.location.href = `/signin?rd=${encodeURIComponent(callbackUrl)}`;
}

export function signOut() {
  window.location.href = "/signout";
}
