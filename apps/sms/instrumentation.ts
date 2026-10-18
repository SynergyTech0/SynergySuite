/** On server start, sends any campaign texts a restart interrupted. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { resume } = await import("./lib/sms");
  await resume().catch((e) => console.error("[sms] couldn't resume sending", e));
}
