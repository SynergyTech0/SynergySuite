import { json } from '@/lib/http';
import { trustedInternal } from '@/lib/internal';
import { getAiSettingsInternal } from '@/lib/ai-settings';

/*
 * For every app's @synergy/ai on the internal network: the AI model saved in the admin console,
 * key included, or null when none is saved (the apps then use their AI_* environment).
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!trustedInternal(req)) return json({ error: 'forbidden' }, 403);
  return json({ settings: await getAiSettingsInternal() });
}
