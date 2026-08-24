import type {
  EvaluationLog,
  EvaluationPlan,
  Failure,
  ModelDefinition,
  RunSummary,
  Scenario,
  TherapyConfig,
  TrialArtifacts,
  TrialResult,
  UsageSummary,
} from "./domain.ts";

export interface ModelAvailability {
  readonly id: string;
  readonly available: boolean;
}

export interface CatalogPort {
  check(
    models: readonly ModelDefinition[],
  ): Promise<readonly ModelAvailability[]>;
}

export interface WorkspaceLease {
  readonly url: string;
  readonly cwd: string;
  readonly notebook: string;
  dispose(): Promise<void>;
}

export interface WorkspacePort {
  start(
    scenario: Scenario,
    artifacts: TrialArtifacts,
    signal?: AbortSignal,
  ): Promise<WorkspaceLease>;
}

export interface HarnessRun {
  readonly log: EvaluationLog;
  readonly session: string;
  readonly finalText?: string;
  readonly usage?: UsageSummary;
  readonly error?: Failure;
}

export interface HarnessPort {
  run(input: {
    readonly plan: EvaluationPlan;
    readonly model: ModelDefinition;
    readonly prompt: string;
    readonly run: RunArtifacts;
    readonly workspace: WorkspaceLease;
    readonly artifacts: TrialArtifacts;
    readonly signal?: AbortSignal;
  }): Promise<HarnessRun>;
}

export interface RunArtifacts {
  readonly root: string;
  readonly inputs: {
    readonly systemPrompt: string;
    readonly systemPromptDigest: string;
    readonly skill: string;
    readonly skillDigest: string;
  };
}

export interface ArtifactPort {
  beginRun(plan: EvaluationPlan): Promise<RunArtifacts>;
  beginTrial(
    run: RunArtifacts,
    model: ModelDefinition,
  ): Promise<TrialArtifacts>;
  writeTrial(artifacts: TrialArtifacts, result: TrialResult): Promise<void>;
  writeSummary(run: RunArtifacts, summary: RunSummary): Promise<void>;
  readSummary(pathOrId: string, config: TherapyConfig): Promise<RunSummary>;
}

export type ProgressEvent =
  | {
    readonly kind: "run_started";
    readonly runId: string;
    readonly artifactRoot: string;
    readonly total: number;
  }
  | {
    readonly kind: "trial_started";
    readonly model: string;
    readonly ordinal: number;
    readonly total: number;
  }
  | {
    readonly kind: "trial_finished";
    readonly model: string;
    readonly status: TrialResult["status"];
    readonly durationMs: number;
  };

export type ProgressSink = (event: ProgressEvent) => void;
