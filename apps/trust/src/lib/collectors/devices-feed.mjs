// Reads the fleet posture summary from Synergy Devices (the suite's Intune and Defender
// equivalent) for the endpoint_compliance and endpoint_threats collectors. Not a collector
// itself, so the registry doesn't list it.
//
// The address and token come from the environment (DEVICES_INTERNAL_URL, DEVICES_SVC_TOKEN),
// never from monitor config, so the token is not stored in Trust's database or shown in the UI.

export class FeedError extends Error {}

export async function readPosture(activeDays, env = process.env) {
  const base = (env.DEVICES_INTERNAL_URL ?? '').replace(/\/+$/, '');
  const token = env.DEVICES_SVC_TOKEN ?? '';
  if (!base || !token) throw new FeedError('DEVICES_INTERNAL_URL and DEVICES_SVC_TOKEN are not set');
  let res;
  try {
    res = await fetch(`${base}/api/svc/posture?active_days=${activeDays}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new FeedError(`could not reach Devices at ${base}: ${err.message}`);
  }
  if (res.status === 401) throw new FeedError('Devices refused the token (check DEVICES_SVC_TOKEN)');
  if (!res.ok) throw new FeedError(`Devices answered ${res.status}`);
  const body = await res.json().catch(() => null);
  if (!body || typeof body.devices !== 'number') throw new FeedError('Devices sent a posture summary this collector does not understand');
  return body;
}

export function validDays(config) {
  const d = config.active_days ?? 30;
  return Number.isInteger(d) && d >= 1 && d <= 365;
}
