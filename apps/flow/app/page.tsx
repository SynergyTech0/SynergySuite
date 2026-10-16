import { redirect } from "next/navigation";
import { FlowApp } from "@/components/FlowApp";
import { currentUser, studioLink } from "@/lib/api";
import { RECIPES } from "@/lib/recipes";

export const dynamic = "force-dynamic";

export default async function Page() {
  // The gateway signs people in before they get here; this only catches a misconfigured deploy.
  const who = await currentUser();
  if (!who) redirect("/signed-out");
  return (
    <FlowApp
      name={who.name}
      studio={studioLink("/")}
      recipes={RECIPES.map(({ id, name, description, apps }) => ({ id, name, description, apps }))}
    />
  );
}
