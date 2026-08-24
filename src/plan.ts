import {
  type EvaluationPlan,
  type ModelDefinition,
  PROVIDER_APIS,
  type Scenario,
  type TherapyConfig,
  TherapyError,
  THINKING_LEVELS,
} from "./domain.ts";

function requireNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new TherapyError(
      "invalid_config",
      `${label} must be a non-empty string`,
    );
  }
}

function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function validateConfig(config: TherapyConfig): void {
  requireNonEmpty(config.provider.id, "provider.id");
  requireNonEmpty(config.provider.baseUrlEnv, "provider.baseUrlEnv");
  requireNonEmpty(config.provider.apiKeyEnv, "provider.apiKeyEnv");
  if (!PROVIDER_APIS.includes(config.provider.api)) {
    throw new TherapyError(
      "invalid_config",
      `Unsupported provider API: ${config.provider.api}`,
    );
  }
  if (!THINKING_LEVELS.includes(config.thinking)) {
    throw new TherapyError(
      "invalid_config",
      `Unsupported thinking level: ${config.thinking}`,
    );
  }
  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0) {
    throw new TherapyError(
      "invalid_config",
      "timeoutMs must be greater than zero",
    );
  }
  if (
    !Number.isFinite(config.marimo.startupTimeoutMs) ||
    config.marimo.startupTimeoutMs <= 0
  ) {
    throw new TherapyError(
      "invalid_config",
      "marimo.startupTimeoutMs must be greater than zero",
    );
  }
  if (
    config.marimo.command.length === 0 ||
    config.marimo.command.some((argument) => argument.trim().length === 0)
  ) {
    throw new TherapyError(
      "invalid_config",
      "marimo.command must contain non-empty command arguments",
    );
  }
  for (
    const [label, value] of [
      ["systemPrompt", config.systemPrompt],
      ["skill", config.skill],
      ["runs", config.runs],
      ["defaultScenario", config.defaultScenario],
    ] as const
  ) {
    requireNonEmpty(value, label);
  }

  if (config.models.length === 0) {
    throw new TherapyError(
      "invalid_config",
      "models must contain at least one model",
    );
  }
  const duplicateModels = findDuplicates(
    config.models.map((model) => model.id),
  );
  if (duplicateModels.length > 0) {
    throw new TherapyError(
      "invalid_config",
      `Duplicate model IDs: ${duplicateModels.join(", ")}`,
    );
  }
  for (const model of config.models) validateModel(model);

  if (config.scenarios.length === 0) {
    throw new TherapyError(
      "invalid_config",
      "scenarios must contain at least one scenario",
    );
  }
  const duplicateScenarios = findDuplicates(
    config.scenarios.map((scenario) => scenario.id),
  );
  if (duplicateScenarios.length > 0) {
    throw new TherapyError(
      "invalid_config",
      `Duplicate scenario IDs: ${duplicateScenarios.join(", ")}`,
    );
  }
  for (const scenario of config.scenarios) validateScenario(scenario);
  if (
    !config.scenarios.some((scenario) => scenario.id === config.defaultScenario)
  ) {
    throw new TherapyError(
      "invalid_config",
      `Default scenario is not configured: ${config.defaultScenario}`,
    );
  }
}

function validateModel(model: ModelDefinition): void {
  requireNonEmpty(model.id, "model.id");
  if (model.input.length === 0 || !model.input.includes("text")) {
    throw new TherapyError(
      "invalid_config",
      `Model ${model.id} must accept text input`,
    );
  }
  if (findDuplicates(model.input).length > 0) {
    throw new TherapyError(
      "invalid_config",
      `Model ${model.id} has duplicate input modalities`,
    );
  }
}

function validateScenario(scenario: Scenario): void {
  requireNonEmpty(scenario.id, "scenario.id");
  requireNonEmpty(scenario.title, `scenario ${scenario.id} title`);
  requireNonEmpty(scenario.prompt, `scenario ${scenario.id} prompt`);
  requireNonEmpty(
    scenario.workspace.fixture,
    `scenario ${scenario.id} fixture`,
  );
  requireNonEmpty(
    scenario.workspace.notebook,
    `scenario ${scenario.id} notebook`,
  );
  if (
    scenario.workspace.notebook === "." ||
    scenario.workspace.notebook === ".." ||
    /[\\/]/.test(scenario.workspace.notebook)
  ) {
    throw new TherapyError(
      "invalid_config",
      `Scenario ${scenario.id} notebook must be one filesystem segment`,
    );
  }
  if (!scenario.prompt.includes("{{notebookUrl}}")) {
    throw new TherapyError(
      "invalid_config",
      `Scenario ${scenario.id} prompt must contain {{notebookUrl}}`,
    );
  }
  if (scenario.predicates.length === 0) {
    throw new TherapyError(
      "invalid_config",
      `Scenario ${scenario.id} must define at least one predicate`,
    );
  }
  const duplicatePredicates = findDuplicates(
    scenario.predicates.map((predicate) => predicate.id),
  );
  if (duplicatePredicates.length > 0) {
    throw new TherapyError(
      "invalid_config",
      `Scenario ${scenario.id} has duplicate predicates: ${
        duplicatePredicates.join(", ")
      }`,
    );
  }
}

export function createEvaluationPlan(
  config: TherapyConfig,
  input: {
    readonly id: string;
    readonly scenario?: string;
    readonly models?: readonly string[];
    readonly runs?: string;
  },
): EvaluationPlan {
  validateConfig(config);
  requireNonEmpty(input.id, "run id");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.id)) {
    throw new TherapyError(
      "invalid_selection",
      "run id must be one safe filesystem segment",
    );
  }

  const scenarioId = input.scenario ?? config.defaultScenario;
  const scenario = config.scenarios.find((candidate) =>
    candidate.id === scenarioId
  );
  if (!scenario) {
    throw new TherapyError(
      "unknown_scenario",
      `Unknown scenario: ${scenarioId}`,
    );
  }

  const requested = input.models ?? config.models.map((model) => model.id);
  if (requested.length === 0) {
    throw new TherapyError("invalid_selection", "Select at least one model");
  }
  const duplicateSelection = findDuplicates(requested);
  if (duplicateSelection.length > 0) {
    throw new TherapyError(
      "invalid_selection",
      `Duplicate selected models: ${duplicateSelection.join(", ")}`,
    );
  }
  const selected = requested.map((id) => {
    const model = config.models.find((candidate) => candidate.id === id);
    if (!model) throw new TherapyError("unknown_model", `Unknown model: ${id}`);
    return model;
  });
  if (input.runs !== undefined) requireNonEmpty(input.runs, "runs");

  return {
    id: input.id,
    scenario,
    provider: config.provider,
    models: config.models,
    trials: selected.map((model, ordinal) => ({ model, ordinal })),
    thinking: config.thinking,
    timeoutMs: config.timeoutMs,
    marimo: config.marimo,
    systemPrompt: config.systemPrompt,
    skill: config.skill,
    runs: input.runs ?? config.runs,
  };
}

export function renderPrompt(scenario: Scenario, notebookUrl: string): string {
  return scenario.prompt.replaceAll("{{notebookUrl}}", notebookUrl);
}

export function modelSlug(modelId: string): string {
  return `model-${encodeURIComponent(modelId).replaceAll("%", "~")}`;
}
