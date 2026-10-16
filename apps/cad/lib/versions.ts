/** "plan.dxf", 3 -> "plan (version 3).dxf" */
export function versionName(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (version ${n})${name.slice(dot)}` : `${name} (version ${n})`;
}
