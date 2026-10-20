import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/api";
import { type Account, UserError, saveMicrosoftAccount, vetEndpoint } from "@/lib/accounts";
import { demoMode } from "@/lib/demo";
import { withImap } from "@/lib/mailbox";
import { MICROSOFT_IMAP, MICROSOFT_SMTP, OAuthError, PENDING_COOKIE, checkPending, finishSignIn, microsoftConfig, publicUrl } from "@/lib/oauth";

export const dynamic = "force-dynamic";

/**
 * Microsoft sends the browser back here with a code. We trade it for tokens, sign in to IMAP once
 * with the access token so a mailbox with IMAP turned off fails now rather than later, save the
 * account and go back to Mail.
 */
export async function GET(req: Request): Promise<Response> {
  const who = await currentUser();
  if (!who) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const jar = await cookies();
  const sealed = jar.get(PENDING_COOKIE)?.value;
  const done = (q: string) => {
    const res = NextResponse.redirect(`${publicUrl()}/?${q}`);
    res.cookies.set(PENDING_COOKIE, "", { path: "/api/oauth/microsoft", maxAge: 0 });
    return res;
  };
  const fail = (error: string) => done(`connectError=${encodeURIComponent(error)}`);

  const sp = new URL(req.url).searchParams;
  const config = microsoftConfig();
  if (demoMode() || !config) return fail("Sign in with Microsoft isn't available on this server");
  if (sp.get("error")) {
    const why = (sp.get("error_description") || sp.get("error") || "").split(/\r?\n/)[0].replace(/^AADSTS\d+:\s*/, "");
    return fail(sp.get("error") === "access_denied" ? "Microsoft sign-in was cancelled" : `Microsoft said: ${why}`);
  }
  const pending = checkPending(sealed, who.email, sp.get("state"));
  const code = sp.get("code");
  if (!pending || !code) return fail("That Microsoft sign-in had expired or wasn't started here. Try Add account again.");

  try {
    const signedIn = await finishSignIn(config, code, pending.verifier);
    const probe: Account = {
      id: "new", owner: who.email, label: signedIn.address, address: signedIn.address, fromName: "",
      imap: await vetEndpoint(MICROSOFT_IMAP),
      smtp: await vetEndpoint(MICROSOFT_SMTP),
      auth: { user: signedIn.address, accessToken: signedIn.accessToken },
    };
    await withImap(probe, async () => undefined);
    await saveMicrosoftAccount(who.email, signedIn);
    return done(`connected=${encodeURIComponent(signedIn.address)}`);
  } catch (err) {
    if (err instanceof OAuthError || err instanceof UserError) return fail(err.message);
    console.error("[mail] Microsoft sign-in failed:", err);
    return fail("Couldn't connect the account");
  }
}
