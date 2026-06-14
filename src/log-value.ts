/** Converts unknown runtime values into a stable log string. */
export function stringifyLogValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }

  if (
    typeof value === "bigint" ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return String(value);
  }

  return JSON.stringify(value);
}
