// Builds a Univer instance from presets, like createUniver() in the
// @univerjs/presets meta-package. We don't depend on that package because it
// also installs Univer's commercial @univerjs-pro packages; this file only uses
// the Apache-2.0 @univerjs/core.
import { IAuthzIoService, LogLevel, Univer, type Plugin, type PluginCtor } from "@univerjs/core";

const OWNER_ROLE = 2; // UnitRole.Owner (@univerjs/protocol)
import { FUniver } from "@univerjs/core/facade";

type PluginEntry = PluginCtor<Plugin> | [PluginCtor<Plugin>, unknown];
export type UniverPreset = { plugins: PluginEntry[] };

export function createUniver({
  presets = [],
  plugins = [],
  ...config
}: ConstructorParameters<typeof Univer>[0] & { presets?: UniverPreset[]; plugins?: PluginEntry[] }) {
  const univer = new Univer({ logLevel: LogLevel.WARN, ...config });
  // Later presets win when two register the same plugin (same as the upstream helper).
  const byName = new Map<string, { plugin: PluginCtor<Plugin>; options?: unknown }>();
  for (const preset of presets) {
    for (const entry of preset.plugins) {
      const [plugin, options] = Array.isArray(entry) ? entry : [entry];
      byName.delete(plugin.pluginName);
      byName.set(plugin.pluginName, { plugin, options });
    }
  }
  for (const entry of plugins) {
    const [plugin, options] = Array.isArray(entry) ? entry : [entry];
    if (byName.has(plugin.pluginName)) throw new Error(`Plugin ${plugin.pluginName} is registered twice`);
    byName.set(plugin.pluginName, { plugin, options });
  }
  byName.forEach(({ plugin, options }) => univer.registerPlugin(plugin, options as never));
  // Univer's built-in permission mock only trusts its own demo user ids, so
  // naming the real signed-in user (comments do) would make it lock the sheet.
  // Who may edit or comment is decided by our server and collab layer; inside
  // the editor the user is the owner.
  try {
    const authz = univer.__getInjector().get(IAuthzIoService) as unknown as { _getRole?: (role: number) => boolean };
    if (authz && "_getRole" in authz) authz._getRole = (role: number) => role === OWNER_ROLE;
  } catch {
    /* a different authz service is registered */
  }
  return { univer, univerAPI: FUniver.newAPI(univer) };
}
