import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

import {
  DEFAULT_AGENTS,
  DEFAULT_DEBATE_CONFIG,
  DEFAULT_PRINCIPAL_MANDATE,
  SwarmConfigSchema,
  type SwarmConfig,
  type ProviderConfig,
} from "./types.js";

export function readInput(name: string): string | undefined {
  const candidates = [
    `INPUT_${name.toUpperCase()}`,
    `INPUT_${name.replace(/-/g, "_").toUpperCase()}`,
    name.toUpperCase(),
    name.replace(/-/g, "_").toUpperCase(),
  ];
  for (const c of candidates) {
    if (process.env[c]) {
      return process.env[c];
    }
  }
  return undefined;
}

function resolveApiKeyReference(value: string): string {
  if (!value.startsWith("$")) {
    return value;
  }

  const match = value.match(/^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/);
  const environmentName = match?.[1] ?? match?.[2];
  if (!environmentName) {
    throw new Error(`Invalid provider API key environment reference: ${value}`);
  }

  const inputName = environmentName.toLowerCase().replace(/_/g, "-");
  const resolvedValue = process.env[environmentName] || readInput(inputName);
  if (!resolvedValue) {
    throw new Error(`Provider API key environment variable ${environmentName} is not set.`);
  }
  return resolvedValue;
}

export function resolveProviderConfig(
  swarmConfig: SwarmConfig,
  legacyAnthropicApiKey: string | undefined,
  legacyAnthropicModel: string,
  legacyAnthropicEndpoint?: string
): ProviderConfig {
  if (!swarmConfig.provider) {
    if (!legacyAnthropicApiKey) {
      throw new Error("Anthropic API key is required (set ANTHROPIC_API_KEY or anthropic-api-key input).");
    }
    return {
      type: "anthropic",
      config: {
        apiKey: legacyAnthropicApiKey,
        model: legacyAnthropicModel,
        ...(legacyAnthropicEndpoint ? { baseURL: legacyAnthropicEndpoint } : {}),
      },
    };
  }

  const { type, config } = swarmConfig.provider;
  if (config.apiKey && config.apiKey.length > 0) {
    return {
      type,
      config: {
        ...config,
        apiKey: resolveApiKeyReference(config.apiKey),
      },
    } as ProviderConfig;
  }

  const resolvedApiKey = readInput(`${type}-api-key`) || (type === "anthropic" ? legacyAnthropicApiKey : undefined);
  if (!resolvedApiKey) {
    throw new Error(`Provider API key is required for ${type}. Please set ${type.toUpperCase()}_API_KEY environment variable.`);
  }

  return {
    type,
    config: {
      ...config,
      apiKey: resolvedApiKey,
    },
  } as ProviderConfig;
}

export function applyPresetDefaults(rawConfig: Record<string, any>): Record<string, any> {
  const preset = rawConfig.preset;
  if (!preset) return rawConfig;

  let presetConfig: Record<string, any> = {};
  if (preset === "fast") {
    presetConfig = {
      agents: [
        {
          name: "security",
          mandate: "Review for high-impact security vulnerabilities and breaking changes.",
        },
      ],
      debate: { rounds: 0 },
      context_enrichment: { enabled: false, max_depth: 1, file_size_limit_kb: 100 },
    };
  } else if (preset === "balanced") {
    presetConfig = {
      agents: DEFAULT_AGENTS.slice(0, 3),
      debate: { rounds: 0 },
    };
  } else if (preset === "thorough") {
    presetConfig = {
      agents: [
        ...DEFAULT_AGENTS,
        {
          name: "dx",
          mandate: "Review for developer experience, documentation clarity, and maintainability.",
        },
      ],
      debate: { rounds: 0 },
      static_analysis: { enabled: true, commands: [] },
    };
  } else if (preset === "requirements") {
    presetConfig = {
      agents: DEFAULT_AGENTS.slice(0, 3),
      debate: { rounds: 0 },
      requirements: { enabled: true, contract_path: ".specbridge/requirements.json", fail_on_violation: false, upload_sarif: false },
    };
  }

  return {
    ...presetConfig,
    ...rawConfig,
    ...(presetConfig.debate || rawConfig.debate ? { debate: { ...presetConfig.debate, ...(rawConfig.debate ?? {}) } } : {}),
    ...(presetConfig.requirements || rawConfig.requirements ? { requirements: { ...presetConfig.requirements, ...(rawConfig.requirements ?? {}) } } : {}),
    ...(presetConfig.context_enrichment || rawConfig.context_enrichment ? { context_enrichment: { ...presetConfig.context_enrichment, ...(rawConfig.context_enrichment ?? {}) } } : {}),
  };
}

export const DEFAULT_SWARM_CONFIG: SwarmConfig = SwarmConfigSchema.parse({
  agents: DEFAULT_AGENTS.slice(0, 3),
  debate: DEFAULT_DEBATE_CONFIG,
  principal: { mandate: DEFAULT_PRINCIPAL_MANDATE },
  output: { mode: "outcome" },
});

export async function loadSwarmConfig(
  workspaceRoot: string = process.cwd(),
  configPath = ".swarm.yml"
): Promise<SwarmConfig> {
  const resolvedConfigPath = path.isAbsolute(configPath)
    ? configPath
    : path.join(workspaceRoot, configPath);

  if (!existsSync(resolvedConfigPath)) {
    console.log(`::warning::Config file not found at ${resolvedConfigPath}, using default configuration.`);
    return DEFAULT_SWARM_CONFIG;
  }

  const rawConfig = await readFile(resolvedConfigPath, "utf8");
  const parsedConfig = (yaml.load(rawConfig) as Record<string, any>) ?? {};
  const mergedConfig = applyPresetDefaults(parsedConfig);
  return SwarmConfigSchema.parse(mergedConfig);
}
