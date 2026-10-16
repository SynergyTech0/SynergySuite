import { body, route } from "@/lib/api";
import { suiteApps } from "@/lib/apps";
import { allTypes, createRule, dlpSettings, labelSettings, templates } from "@/lib/protection";

/** Everything the DLP screens need: rules, sensitive information types, internal domains, labels and starting templates. */
export const GET = route("protection", async () => {
  const [s, labels] = await Promise.all([dlpSettings(), labelSettings()]);
  return {
    rules: s.rules,
    types: allTypes(s),
    customTypes: s.types,
    internalDomains: s.internalDomains,
    extraDomains: s.extraDomains,
    labels: labels.labels,
    templates: templates(),
    apps: suiteApps().filter((a) => a.id !== "auth" && a.id !== "home").map((a) => ({ id: a.id, name: a.name })),
  };
});
export const POST = route("protection", async (me, req) => createRule(me, await body(req)));
