import { redirect } from "next/navigation";
import { VaultApp } from "@/components/VaultApp";
import { currentUser } from "@/lib/api";
import { accessContact, canUseVault } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function Page() {
  // The gateway signs people in before they get here; this only catches a misconfigured deploy.
  const me = await currentUser();
  if (!me) redirect("/signed-out");
  if (!canUseVault(me.email)) {
    const contact = accessContact();
    return (
      <div className="center">
        <div className="gate">
          <h1>No access to the vault</h1>
          <p className="muted">
            {me.email} is not on the vault&apos;s access list. {contact ? <>Ask {contact} to add you.</> : <>Ask your administrator to add you.</>}
          </p>
        </div>
      </div>
    );
  }
  return <VaultApp />;
}
