import {
  canAttemptProvider,
  providerHealthSnapshot,
  type SurvivalProvider,
} from "@/lib/survival/provider-health";

export type ResourceCapability =
  | "text"
  | "reasoning"
  | "research"
  | "code"
  | "memory"
  | "vision"
  | "image";

export type ResourceId =
  | "self-hosted"
  | "groq"
  | "vercel-gateway"
  | "emergency-gateway"
  | "web-search"
  | "sandbox"
  | "memory";

export type ResourceDescriptor = {
  id: ResourceId;
  label: string;
  capabilities: ResourceCapability[];
  priority: number;
  configured: boolean;
  available: boolean;
  reason?: string;
};

export type ResourceRuntimeOverride = {
  configured?: boolean;
  available?: boolean;
  reason?: string;
};

export type ResourceRuntimeOverrides = Partial<
  Record<ResourceId, ResourceRuntimeOverride>
>;

function env(name: string) {
  return Boolean(process.env[name]?.trim());
}

function configured(id: ResourceId) {
  switch (id) {
    case "self-hosted":
      // A generic Supabase brain gateway existing is not the same thing as a
      // configured GPU/model. Runtime health should override this value.
      return Boolean(
        process.env.KHASROY_SELF_HOSTED_BASE_URL?.trim() &&
          process.env.KHASROY_SELF_HOSTED_MODEL?.trim(),
      );
    case "groq":
      return env("GROQ_API_KEY");
    case "vercel-gateway":
      return env("AI_GATEWAY_API_KEY") || Boolean(process.env.VERCEL);
    case "emergency-gateway":
      return Boolean(
        process.env.KHASROY_EMERGENCY_CHAT_GATEWAY?.trim() ||
          process.env.KHASROY_OWNER_KEY?.trim(),
      );
    case "web-search":
    case "sandbox":
    case "memory":
      return true;
  }
}

const DEFINITIONS: Array<Omit<ResourceDescriptor, "configured" | "available">> = [
  {
    id: "self-hosted",
    label: "Khasroy Self-Hosted Brain",
    capabilities: ["text", "reasoning"],
    priority: 100,
  },
  {
    id: "groq",
    label: "Groq",
    capabilities: ["text", "reasoning"],
    priority: 90,
  },
  {
    id: "vercel-gateway",
    label: "Vercel AI Gateway",
    capabilities: ["text", "reasoning", "vision"],
    priority: 70,
  },
  {
    id: "emergency-gateway",
    label: "Emergency Text Gateway",
    capabilities: ["text"],
    priority: 40,
  },
  {
    id: "web-search",
    label: "Server Web Search",
    capabilities: ["research"],
    priority: 100,
  },
  {
    id: "sandbox",
    label: "Vercel Sandbox",
    capabilities: ["code"],
    priority: 100,
  },
  {
    id: "memory",
    label: "Supabase Memory",
    capabilities: ["memory"],
    priority: 100,
  },
];

function survivalProvider(id: ResourceId): SurvivalProvider {
  return id;
}

export function resourceRegistry(
  overrides: ResourceRuntimeOverrides = {},
): ResourceDescriptor[] {
  const snapshot = providerHealthSnapshot() as Record<
    string,
    { available?: boolean; cooldownRemainingMs?: number }
  >;

  return DEFINITIONS.map((definition) => {
    const override = overrides[definition.id];
    const baseConfigured = configured(definition.id);
    const isConfigured = override?.configured ?? baseConfigured;
    const health = snapshot[definition.id];
    const healthAllows = canAttemptProvider(survivalProvider(definition.id));
    const runtimeAllows = override?.available ?? true;
    const available = isConfigured && healthAllows && runtimeAllows;

    return {
      ...definition,
      configured: isConfigured,
      available,
      reason:
        override?.reason ||
        (!isConfigured
          ? "not_configured"
          : !healthAllows
            ? `cooldown_${Math.max(0, Number(health?.cooldownRemainingMs) || 0)}ms`
            : !runtimeAllows
              ? "offline"
              : undefined),
    };
  });
}

export function resourcesFor(
  capability: ResourceCapability,
  options: {
    includeUnavailable?: boolean;
    overrides?: ResourceRuntimeOverrides;
  } = {},
) {
  return resourceRegistry(options.overrides)
    .filter((resource) => resource.capabilities.includes(capability))
    .filter((resource) => options.includeUnavailable || resource.available)
    .sort((a, b) => b.priority - a.priority);
}

export function preferredResource(
  capability: ResourceCapability,
  options: { overrides?: ResourceRuntimeOverrides } = {},
) {
  return resourcesFor(capability, { overrides: options.overrides })[0] || null;
}

export function resourcePlan(
  capabilities: ResourceCapability[],
  options: { overrides?: ResourceRuntimeOverrides } = {},
) {
  return Object.fromEntries(
    capabilities.map((capability) => [
      capability,
      resourcesFor(capability, {
        includeUnavailable: true,
        overrides: options.overrides,
      }),
    ]),
  );
}
