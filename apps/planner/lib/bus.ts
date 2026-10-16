import { EventEmitter } from "events";

// One process-wide event bus (stable across the Node module cache). Mutations publish(boardId,…),
// the SSE stream route subscribes per board and pushes to connected clients. Single-instance
// realtime; a multi-instance deploy would swap this for Redis pub/sub (same publish() seam).
const g = globalThis as unknown as { __sbBus?: EventEmitter };
export const bus = g.__sbBus ?? new EventEmitter();
bus.setMaxListeners(0);
g.__sbBus = bus;

export function publish(boardId: string | null | undefined, event: unknown) {
  if (boardId) bus.emit(boardId, event);
}
