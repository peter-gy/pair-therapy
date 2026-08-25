import type { EvaluationPlan, Failure, TrialResult } from "./domain.ts";
import { TherapyError } from "./domain.ts";
import {
  evaluatePredicates,
  statusFromPredicates,
  summarizeRun,
} from "./evaluate.ts";
import { renderPrompt } from "./plan.ts";
import type {
  ArtifactPort,
  CatalogPort,
  HarnessPort,
  HarnessRun,
  ProgressSink,
  WorkspacePort,
} from "./ports.ts";

function failure(error: unknown): Failure {
  return error instanceof TherapyError
    ? { code: error.code, message: error.message }
    : {
      code: "trial_failed",
      message: error instanceof Error ? error.message : String(error),
    };
}

export function createEvaluationRunner(input: {
  readonly catalog: CatalogPort;
  readonly workspace: WorkspacePort;
  readonly harness: HarnessPort;
  readonly artifacts: ArtifactPort;
  readonly now?: () => Date;
}) {
  const now = input.now ?? (() => new Date());

  return async function runEvaluation(
    plan: EvaluationPlan,
    options: {
      readonly signal?: AbortSignal;
      readonly progress?: ProgressSink;
    } = {},
  ) {
    const availability = await input.catalog.check(
      plan.trials.map((trial) => trial.model),
    );
    const missing = availability.filter((item) => !item.available).map((item) =>
      item.id
    );
    if (missing.length > 0) {
      throw new TherapyError(
        "models_unavailable",
        `Models are absent from the endpoint catalog: ${missing.join(", ")}`,
      );
    }

    const started = now();
    const run = await input.artifacts.beginRun(plan);
    options.progress?.({
      kind: "run_started",
      runId: plan.id,
      artifactRoot: run.root,
      total: plan.trials.length,
    });
    const results: TrialResult[] = [];

    for (const trial of plan.trials) {
      if (options.signal?.aborted) {
        throw new TherapyError("aborted", "Evaluation aborted");
      }
      const trialStarted = now();
      const artifacts = await input.artifacts.beginTrial(run, trial.model);
      options.progress?.({
        kind: "trial_started",
        model: trial.model.id,
        ordinal: trial.ordinal,
        total: plan.trials.length,
      });

      let workspace: Awaited<ReturnType<WorkspacePort["start"]>> | undefined;
      let result: TrialResult | undefined;
      try {
        workspace = await input.workspace.start(
          plan.scenario,
          artifacts,
          options.signal,
        );
        const cancel = new AbortController();
        const forwardAbort = () => cancel.abort();
        options.signal?.addEventListener("abort", forwardAbort, {
          once: true,
        });
        if (options.signal?.aborted) cancel.abort();
        const sessionLost = workspace.failed.then((error) => {
          cancel.abort();
          throw new TherapyError(error.code, error.message);
        });
        let output: HarnessRun;
        try {
          output = await Promise.race([
            input.harness.run({
              plan,
              model: trial.model,
              prompt: renderPrompt(plan.scenario, workspace.url),
              run,
              workspace,
              artifacts,
              signal: cancel.signal,
            }),
            sessionLost,
          ]);
        } finally {
          options.signal?.removeEventListener("abort", forwardAbort);
        }
        let predicates = evaluatePredicates(
          plan.scenario.predicates,
          output.log,
        );
        if (output.error) {
          predicates = predicates.map((predicate) =>
            predicate.status === "fail" && predicate.evidence.length === 0
              ? {
                ...predicate,
                status: "error" as const,
                message: `Evaluation incomplete: ${output.error?.message}`,
              }
              : predicate
          );
        }
        const finished = now();
        result = {
          scenario: plan.scenario.id,
          model: trial.model.id,
          status: output.error ? "error" : statusFromPredicates(predicates),
          startedAt: trialStarted.toISOString(),
          finishedAt: finished.toISOString(),
          durationMs: finished.getTime() - trialStarted.getTime(),
          predicates,
          usage: output.usage,
          finalText: output.finalText,
          error: output.error,
          artifacts: {
            session: output.session,
            workspace: artifacts.workspace,
            marimoLog: artifacts.marimoLog,
          },
        };
      } catch (error) {
        const finished = now();
        result = {
          scenario: plan.scenario.id,
          model: trial.model.id,
          status: "error",
          startedAt: trialStarted.toISOString(),
          finishedAt: finished.toISOString(),
          durationMs: finished.getTime() - trialStarted.getTime(),
          predicates: [],
          error: failure(error),
          artifacts: {
            workspace: artifacts.workspace,
            marimoLog: artifacts.marimoLog,
          },
        };
      } finally {
        if (workspace) {
          try {
            await workspace.dispose();
          } catch (error) {
            const cleanup = failure(error);
            if (result && result.status !== "error") {
              result = { ...result, status: "error", error: cleanup };
            }
          }
        }
      }

      if (!result) {
        throw new TherapyError(
          "trial_failed",
          `Trial ${trial.model.id} completed without a result`,
        );
      }
      results.push(result);
      await input.artifacts.writeTrial(artifacts, result);
      options.progress?.({
        kind: "trial_finished",
        model: result.model,
        status: result.status,
        durationMs: result.durationMs,
      });
    }

    const finished = now();
    const summary = summarizeRun({
      id: plan.id,
      scenario: plan.scenario.id,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: finished.getTime() - started.getTime(),
      results,
    });
    await input.artifacts.writeSummary(run, summary);
    return { summary, artifacts: run };
  };
}
