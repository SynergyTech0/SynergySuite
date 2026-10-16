import crypto from "crypto";

/**
 * Generates a cryptographically secure invitation token
 * Uses 32 bytes of random data encoded as URL-safe base64
 * 
 * @returns A unique, unpredictable token string
 */
export function generateInvitationToken(): string {
	return crypto.randomBytes(32).toString("base64url");
}

/**
 * Validates that a token string has the expected format
 * 
 * @param token - The token to validate
 * @returns True if the token format is valid
 */
export function isValidTokenFormat(token: string): boolean {
	// Base64url tokens should be 43 characters (32 bytes -> 43 base64url chars)
	return typeof token === "string" && token.length === 43 && /^[A-Za-z0-9_-]+$/.test(token);
}
