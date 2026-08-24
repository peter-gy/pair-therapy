export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export const PROVIDER_APIS = [
  "openai-completions",
  "openai-responses",
] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type ProviderApi = (typeof PROVIDER_APIS)[number];
export type InputModality = "text" | "image";
export type EvaluationStatus = "pass" | "fail" | "error";

export interface ProviderDefinition {
  readonly id: string;
  readonly api: ProviderApi;
  readonly baseUrlEnv: string;
  readonly apiKeyEnv: string;
}

export interface ModelDefinition {
  readonly id: string;
  readonly reasoning: boolean;
  readonly input: readonly InputModality[];
}

export interface MarimoDefinition {
  readonly command: readonly [string, ...string[]];
  readonly startupTimeoutMs: number;
}

export interface WorkspaceDefinition {
  readonly fixture: string;
  readonly notebook: string;
}

export interface EvidenceRef {
  readonly entryId: string;
  readonly sequence: number;
  readonly toolCallId?: string;
  readonly excerpt?: string;
}

export interface PredicateResult {
  readonly id: string;
  readonly status: EvaluationStatus;
  readonly message: string;
  readonly evidence: readonly EvidenceRef[];
}

export interface Predicate {
  readonly id: string;
  readonly description: string;
  readonly evaluate: (log: EvaluationLog) => PredicateResult;
}

export interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  readonly workspace: WorkspaceDefinition;
  readonly predicates: readonly Predicate[];
}

export interface TherapyConfig {
  readonly provider: ProviderDefinition;
  readonly models: readonly ModelDefinition[];
  readonly thinking: ThinkingLevel;
  readonly timeoutMs: number;
  readonly marimo: MarimoDefinition;
  readonly systemPrompt: string;
  readonly skill: string;
  readonly runs: string;
  readonly defaultScenario: string;
  readonly scenarios: readonly Scenario[];
}

export interface ToolCallEvent {
  readonly kind: "tool_call";
  readonly sequence: number;
  readonly entryId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface ToolResultEvent {
  readonly kind: "tool_result";
  readonly sequence: number;
  readonly entryId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output: string;
  readonly isError: boolean;
}

export interface AssistantErrorEvent {
  readonly kind: "assistant_error";
  readonly sequence: number;
  readonly entryId: string;
  readonly message: string;
}

export type EvaluationEvent =
  | ToolCallEvent
  | ToolResultEvent
  | AssistantErrorEvent;

export interface EvaluationLog {
  readonly events: readonly EvaluationEvent[];
}

export interface PlannedTrial {
  readonly model: ModelDefinition;
  readonly ordinal: number;
}

export interface EvaluationPlan {
  readonly id: string;
  readonly scenario: Scenario;
  readonly provider: ProviderDefinition;
  readonly models: readonly ModelDefinition[];
  readonly trials: readonly PlannedTrial[];
  readonly thinking: ThinkingLevel;
  readonly timeoutMs: number;
  readonly marimo: MarimoDefinition;
  readonly systemPrompt: string;
  readonly skill: string;
  readonly runs: string;
}

export interface UsageSummary {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly total: number;
  readonly cost: number;
}

export interface Failure {
  readonly code: string;
  readonly message: string;
}

export interface TrialArtifacts {
  readonly root: string;
  readonly workspace: string;
  readonly harness: string;
  readonly marimoLog: string;
}

export interface TrialResult {
  readonly scenario: string;
  readonly model: string;
  readonly status: EvaluationStatus;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly predicates: readonly PredicateResult[];
  readonly usage?: UsageSummary;
  readonly finalText?: string;
  readonly error?: Failure;
  readonly artifacts: {
    readonly session?: string;
    readonly workspace: string;
    readonly marimoLog: string;
  };
}

export interface RunSummary {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly scenario: string;
  readonly status: EvaluationStatus;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly counts: {
    readonly total: number;
    readonly pass: number;
    readonly fail: number;
    readonly error: number;
  };
  readonly predicateCounts: {
    readonly total: number;
    readonly pass: number;
    readonly fail: number;
    readonly error: number;
  };
  readonly results: readonly TrialResult[];
}

export class TherapyError extends Error {
  constructor(
    readonly code: string,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TherapyError";
  }
}
