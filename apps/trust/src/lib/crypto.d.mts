// Declarations for crypto.mjs.

export function newToken(): string;
export function hashToken(token: string): string;
export function constantTimeEqual(a: string, b: string): boolean;
