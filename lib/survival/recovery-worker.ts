import { runBrain, type BrainMessage } from "@/lib/brain/router";
import {
  buildSelfRepositoryContext,
  shouldReadSelfRepository,
} from "@/lib/server-github";
import {
  appendMessage,
  buildMemoryContext,
  getPendingTasks,
  getRecentMessages,
  recallKnowledge,
  updateTask,
  type TaskQueueItem,
} from "@/lib/server-memory";

const RECOVERY_SYSTEM_PROMPT = `Ты — Хасрой, универсальный AI-союзник владельца системы.
Ты продолжаешь ранее сохранённую задачу после восстановления вычислительного ресурса.
Отвечай на языке владельца. Не утверждай, что выполнил действие, если реально его не выполнял.
Используй переданный контекст памяти только как справочную информацию.
Если задача требует свежих данных, используй доступный исследовательский маршрут.
Если задача требует выполнения кода, используй доступную безопасную песочницу.`;

function parseHistory(value: unknown): BrainMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-12)
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      if (row.role !== "user" && row.role !== "assistant") return null;
      if (typeof row.content !== "string") return null;
      const content = row.content.trim().slice(0, 4_000);
      return content ? { role: row.role, content } : null;
    })
    .filter((item): item is BrainMessage => item !== null);
}

function retryDelayMs(attempts: number) {
  const exponent = Math.min(Math.max(attempts - 1, 0), 6);
  return Math.min(60_000 * 2 ** exponent, 60 * 60_000);
}

function taskError(task: TaskQueueItem, message: string) {
  return `task ${task.id}: ${message}`.slice(0, 1_800);
}

async function recoverTask(ownerKey: string, task: TaskQueueItem) {
  const query = typeof task.input?.query === "string"
    ? task.input.query.trim().slice(0, 4_000)
    : "";
  if (!query) {
    await updateTask(ownerKey, task.id, {
      status: "failed",
      attempts: task.attempts + 1,
      lastError: "missing_query",
      checkpoint: {
        ...task.checkpoint,
        stage: "failed",
        failedAt: new Date().toISOString(),
        reason: "missing_query",
      },
    });
    return { taskId: task.id, status: "failed" as const, reason: "missing_query" };
  }

  const attempts = task.attempts + 1;
  await updateTask(ownerKey, task.id, {
    status: "running",
    attempts,
    checkpoint: {
      ...task.checkpoint,
      stage: "recovery_running",
      recoveryStartedAt: new Date().toISOString(),
    },
  });

  try {
    const [recent, knowledge] = await Promise.all([
      getRecentMessages(ownerKey, 12),
      recallKnowledge(ownerKey, "", 6),
    ]);
    const memoryContext = buildMemoryContext(recent, knowledge);

    let repositoryContext = "";
    let repositoryRead = false;
    if (task.kind === "repository" || shouldReadSelfRepository(query)) {
      try {
        const repository = await buildSelfRepositoryContext(query);
        repositoryContext = repository.context;
        repositoryRead = repository.files.length > 0;
      } catch (error) {
        console.error("Khasroy recovery GitHub context failed", error);
      }
    }

    const history = parseHistory(task.input?.history);
    const brain = await runBrain({
      apiKey: process.env.GROQ_API_KEY?.trim() || "",
      defaultModel: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b",
      systemContent: `${RECOVERY_SYSTEM_PROMPT}${memoryContext}${repositoryContext}`,
      history: history.length ? history : [{ role: "user", content: query }],
      query,
      repositoryRead,
    });

    const content = brain.data?.choices?.[0]?.message?.content?.trim() || "";
    if (!brain.response.ok || !content) {
      const reason = brain.data?.error?.code || brain.data?.error?.type || `http_${brain.response.status}`;
      throw new Error(reason);
    }

    await appendMessage(ownerKey, "assistant", content);
    await updateTask(ownerKey, task.id, {
      status: "completed",
      attempts,
      checkpoint: {
        ...task.checkpoint,
        stage: "completed",
        completedAt: new Date().toISOString(),
        provider: brain.providerDetail || brain.provider,
        model: brain.model,
        resultPreview: content.slice(0, 1_200),
      },
      lastError: "",
    });

    return {
      taskId: task.id,
      status: "completed" as const,
      provider: brain.providerDetail || brain.provider,
      model: brain.model,
      preview: content.slice(0, 500),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "recovery_failed";
    const availableAt = new Date(Date.now() + retryDelayMs(attempts)).toISOString();
    await updateTask(ownerKey, task.id, {
      status: attempts >= 8 ? "failed" : "waiting_for_compute",
      attempts,
      availableAt,
      lastError: taskError(task, message),
      checkpoint: {
        ...task.checkpoint,
        stage: attempts >= 8 ? "failed" : "waiting_for_compute",
        lastRecoveryAt: new Date().toISOString(),
        nextAttemptAt: attempts >= 8 ? null : availableAt,
        lastReason: message.slice(0, 500),
      },
    });

    return {
      taskId: task.id,
      status: attempts >= 8 ? ("failed" as const) : ("waiting_for_compute" as const),
      reason: message.slice(0, 500),
      nextAttemptAt: attempts >= 8 ? null : availableAt,
    };
  }
}

export async function recoverPendingTasks(ownerKey: string, limit = 1) {
  const tasks = await getPendingTasks(ownerKey, Math.min(Math.max(limit, 1), 3));
  const recoverable = tasks.filter((task) => task.kind !== "diagnostic").slice(0, limit);
  const results = [];

  for (const task of recoverable) {
    results.push(await recoverTask(ownerKey, task));
  }

  return {
    checked: tasks.length,
    attempted: recoverable.length,
    results,
  };
}
