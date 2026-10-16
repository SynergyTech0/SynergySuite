import { activeAutomationsFor, scheduleAutomationRun, now } from './repo';

/** Called when a contact is newly added to an audience — queues any welcome automations. */
export async function onContactAdded(audienceId: string, contactId: string): Promise<void> {
  const autos = await activeAutomationsFor(audienceId);
  for (const a of autos) {
    const due = now() + Number(a.delay_min ?? 0) * 60_000;
    await scheduleAutomationRun(a.id, contactId, due);
  }
}
