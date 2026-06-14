/** Label used when formatting GitLab API response validation errors. */
export type GitLabResponseSource = string;

/** Reads a GitLab API response object. */
export function asRecord(
  value: unknown,
  source: GitLabResponseSource = "GitLab API",
): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new Error(`Expected ${source} response object`);
}

/** Reads a GitLab API response array. */
export function asArray(
  value: unknown,
  source: GitLabResponseSource = "GitLab API",
): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  throw new Error(`Expected ${source} response array`);
}

/** Reads a required string field from a GitLab API response object. */
export function readString(
  data: Record<string, unknown>,
  key: string,
  source: GitLabResponseSource = "GitLab API",
): string {
  const value = data[key];

  if (typeof value === "string") {
    return value;
  }

  throw new Error(`Expected ${source} field ${key} to be a string`);
}

/** Reads an optional string field from a GitLab API response object. */
export function readOptionalString(
  data: Record<string, unknown>,
  key: string,
  source: GitLabResponseSource = "GitLab API",
): string | undefined {
  const value = data[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  throw new Error(`Expected ${source} field ${key} to be a string`);
}

/** Reads a required number field from a GitLab API response object. */
export function readNumber(
  data: Record<string, unknown>,
  key: string,
  source: GitLabResponseSource = "GitLab API",
): number {
  const value = data[key];

  if (typeof value === "number") {
    return value;
  }

  throw new Error(`Expected ${source} field ${key} to be a number`);
}

/** Reads a required boolean field from a GitLab API response object. */
export function readBoolean(
  data: Record<string, unknown>,
  key: string,
  source: GitLabResponseSource = "GitLab API",
): boolean {
  const value = data[key];

  if (typeof value === "boolean") {
    return value;
  }

  throw new Error(`Expected ${source} field ${key} to be a boolean`);
}

/** Reads an optional boolean field from a GitLab API response object. */
export function readOptionalBoolean(
  data: Record<string, unknown>,
  key: string,
  source: GitLabResponseSource = "GitLab API",
): boolean | undefined {
  const value = data[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  throw new Error(`Expected ${source} field ${key} to be a boolean`);
}

/** Reads a string array field from a GitLab API response object. */
export function readStringArray(
  data: Record<string, unknown>,
  key: string,
  source: GitLabResponseSource = "GitLab API",
): string[] {
  const value = data[key];

  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }

  throw new Error(`Expected ${source} field ${key} to be a string array`);
}

/** Creates stable JSON for deterministic fingerprints. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJsonValue(item)]),
    );
  }

  return value;
}
