import { route } from "@/lib/api";
import { counts } from "@/lib/matters";
import { people } from "@/lib/directory";

export const GET = route("apps", async () => {
  const [c, d] = await Promise.all([counts(), people()]);
  return { ...c, people: d.configured && !d.error ? d.total : null, directory: d.configured ? (d.error ? "error" : "ok") : "unset" };
});
