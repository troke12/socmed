// Lightweight structured logger. Avoids pino dependency to keep install small.
// JSON output goes to stdout (or a writable file via LOG_FILE env).

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function getMinLevel(): number {
  const env = (process.env.SOCMED_LOG_LEVEL ?? "info").toLowerCase() as Level;
  return LEVELS[env] ?? LEVELS.info;
}

const MIN = getMinLevel();

function shouldLog(level: Level): boolean {
  return LEVELS[level] >= MIN;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const record = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  };
  const line = JSON.stringify(record);
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
  child(extra: Record<string, unknown>) {
    return {
      debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, { ...extra, ...fields }),
      info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, { ...extra, ...fields }),
      warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, { ...extra, ...fields }),
      error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, { ...extra, ...fields }),
    };
  },
};
