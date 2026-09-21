// OCR PROBE - intentionally bad code to test the automated reviewer.
// DO NOT MERGE. This file exists only to verify OpenCodeReview flags obvious issues.
export function runUserCode(code: string): unknown {
  return eval(code);
}

export const ADMIN_API_KEY = "sk-probe-hardcoded-secret-12345";

export function generatePasswordResetToken(): string {
  return Math.random().toString(36).slice(2);
}

export function buildUserQuery(userId: string): string {
  return `SELECT * FROM users WHERE id = '${userId}'`;
}

export function parseConfig(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
