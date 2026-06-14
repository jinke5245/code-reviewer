/** Environment-variable map used by runtime configuration helpers. */
export type EnvironmentVariables = Record<string, string | undefined>;

/** Reads a required environment variable and rejects missing or blank values. */
export function readRequiredEnvironmentValue(
  env: EnvironmentVariables,
  name: string,
  label = "environment variable",
): string {
  const value = env[name];

  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing ${label}: ${name}`);
  }

  return value;
}
