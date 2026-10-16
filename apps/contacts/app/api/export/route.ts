import { route } from "@/lib/api";
import { exportCards } from "@/lib/contacts";
import { toContactsCsv } from "@/lib/csv";
import { download } from "@/lib/serve";
import { toVCard } from "@/lib/vcard";

export const GET = route(async (me, req) => {
  const u = new URL(req.url);
  const ids = u.searchParams.get("ids")?.split(",").filter(Boolean);
  const cards = await exportCards(me.email, ids);
  if (u.searchParams.get("format") === "csv") return download(toContactsCsv(cards), "contacts.csv", "text/csv");
  const name = cards.length === 1 ? `${cards[0].displayName.replace(/[^\w .-]+/g, "").trim() || "contact"}.vcf` : "contacts.vcf";
  return download(cards.map(toVCard).join(""), name, "text/vcard");
});
