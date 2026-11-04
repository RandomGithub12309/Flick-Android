/**
 * Defensive readers for third-party JSON.
 *
 * Both hosts Flick pulls from (Reddit and X) return payloads whose shape
 * drifts between endpoints and versions, and a listing row that fails to read
 * must drop the post — never throw and take the whole shuffle down with it.
 * So every field goes through one of these rather than a cast.
 */

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Numeric strings are accepted: X sends ids and counts as strings. */
export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function asBool(value: unknown): boolean {
  return value === true;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
