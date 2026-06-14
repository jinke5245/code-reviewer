import pino from "pino";
import type { DestinationStream, Logger } from "pino";

import { stringifyLogValue } from "./log-value.js";

/** Text sink used by CLI logging. */
export type LogWriter = (text: string) => void;

/** Logger surface used by the CLI. */
export type CliLogger = Pick<Logger, "debug" | "error" | "info" | "warn">;

const pinoLevelLabels: Partial<Record<number, string>> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

const pinoReservedKeys = new Set([
  "hostname",
  "level",
  "msg",
  "pid",
  "time",
  "v",
]);

/** Creates a Pino-backed logger that writes readable GitLab CI log lines. */
export function createReadableLogger(write: LogWriter): CliLogger {
  const stream: DestinationStream = {
    write(line) {
      write(formatPinoLine(line));
    },
  };

  return pino(
    {
      base: null,
      level: "info",
      timestamp: false,
    },
    stream,
  );
}

function formatPinoLine(line: string): string {
  const record = readPinoRecord(line);
  const level =
    typeof record.level === "number" ? formatPinoLevel(record.level) : "info";
  const message = typeof record.msg === "string" ? record.msg : "";
  const fields = Object.entries(record)
    .filter(([key]) => !pinoReservedKeys.has(key))
    .map(([key, value]) => `${key}=${formatFieldValue(value)}`);
  const suffix = fields.length === 0 ? "" : ` ${fields.join(" ")}`;

  return `[codereviewer] ${level}: ${message}${suffix}`;
}

function formatPinoLevel(level: number): string {
  if (Object.hasOwn(pinoLevelLabels, level)) {
    return pinoLevelLabels[level] ?? String(level);
  }

  return String(level);
}

function readPinoRecord(line: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(line) as unknown;

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {
      msg: line.trimEnd(),
    };
  }

  return {
    msg: line.trimEnd(),
  };
}

function formatFieldValue(value: unknown): string {
  if (typeof value === "string") {
    return /\s/u.test(value) ? JSON.stringify(value) : value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return String(value);
  }

  return stringifyLogValue(value);
}
