// Sentry helper pour Edge Functions Deno
// Usage: import { captureException } from "../_shared/sentry.ts";

const SENTRY_DSN = Deno.env.get("SENTRY_DSN") || "";

interface SentryPayload {
  dsn: string;
  event_id: string;
  exception: { values: { type: string; value: string; stacktrace?: object }[] };
  level: string;
  platform: string;
  environment: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

function parseDsn(dsn: string) {
  try {
    const url = new URL(dsn);
    const key = url.username;
    const host = url.hostname;
    const projectId = url.pathname.replace("/", "");
    return { key, host, projectId };
  } catch {
    return null;
  }
}

export async function captureException(
  err: unknown,
  context?: { functionName?: string; extra?: Record<string, unknown> }
): Promise<void> {
  if (!SENTRY_DSN) return;

  const parsed = parseDsn(SENTRY_DSN);
  if (!parsed) return;

  const error = err instanceof Error ? err : new Error(String(err));

  const payload: SentryPayload = {
    dsn: SENTRY_DSN,
    event_id: crypto.randomUUID().replace(/-/g, ""),
    exception: {
      values: [
        {
          type: error.name || "Error",
          value: error.message,
          stacktrace: error.stack
            ? {
                frames: error.stack
                  .split("\n")
                  .slice(1)
                  .map((line) => ({ filename: line.trim() })),
              }
            : undefined,
        },
      ],
    },
    level: "error",
    platform: "javascript",
    environment: Deno.env.get("ENVIRONMENT") || "production",
    tags: { function: context?.functionName || "unknown" },
    extra: context?.extra,
  };

  const { key, host, projectId } = parsed;
  const endpoint = `https://${host}/api/${projectId}/store/`;

  try {
    await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${key}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Silencieux — ne pas casser l'Edge Function si Sentry est down
  }
}
