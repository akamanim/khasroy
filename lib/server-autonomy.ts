const AUTONOMY_ENDPOINT =
  process.env.KHASROY_AUTONOMY_ENDPOINT ||
  "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-autonomy";

export type AutonomyGoal = {
  id: string;
  title: string;
  description: string;
  priority: number;
  status: "queued" | "active" | "blocked" | "completed" | "cancelled";
  source: string;
  created_at: string;
};

export type AutonomyRun = {
  id: string;
  goal_id: string | null;
  status: "started" | "completed" | "failed" | "blocked";
  phase: string;
  provider: string | null;
  model: string | null;
  summary: string | null;
  evidence: Record<string, unknown>;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

async function autonomyCall<T>(body: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const publishableKey = process.env.KHASROY_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (publishableKey) headers.apikey = publishableKey;

  const response = await fetch(AUTONOMY_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Autonomy service failed (${response.status}): ${text.slice(0, 240)}`,
    );
  }

  return (await response.json()) as T;
}

export async function getNextAutonomyGoal(ownerKey: string) {
  return autonomyCall<AutonomyGoal | null>({ action: "next_goal", ownerKey });
}

export async function startAutonomyRun(
  ownerKey: string,
  goalId: string,
  provider: string,
  model: string,
) {
  return autonomyCall<{ id: string; started_at: string } | null>({
    action: "start_run",
    ownerKey,
    goalId,
    phase: "plan",
    provider,
    model,
  });
}

export async function finishAutonomyRun(
  ownerKey: string,
  args: {
    runId: string;
    goalId: string;
    status: "completed" | "failed" | "blocked";
    phase: string;
    provider?: string;
    model?: string;
    summary?: string;
    evidence?: Record<string, unknown>;
    error?: string;
  },
) {
  return autonomyCall<{ ok: boolean }>({
    action: "finish_run",
    ownerKey,
    ...args,
  });
}

export async function getRecentAutonomyRuns(ownerKey: string, limit = 8) {
  return autonomyCall<AutonomyRun[]>({
    action: "recent_runs",
    ownerKey,
    limit,
  });
}
