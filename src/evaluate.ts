import type {
  EvaluationLog,
  EvaluationStatus,
  Predicate,
  PredicateResult,
  RunSummary,
  TrialResult,
} from "./domain.ts";

export function evaluatePredicates(
  predicates: readonly Predicate[],
  log: EvaluationLog,
): readonly PredicateResult[] {
  return predicates.map((predicate) => {
    try {
      return predicate.evaluate(log);
    } catch (error) {
      return {
        id: predicate.id,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        evidence: [],
      };
    }
  });
}

export function statusFromPredicates(
  predicates: readonly PredicateResult[],
): EvaluationStatus {
  if (predicates.some((predicate) => predicate.status === "error")) {
    return "error";
  }
  if (predicates.every((predicate) => predicate.status === "pass")) {
    return "pass";
  }
  return "fail";
}

export function summarizeRun(input: {
  readonly id: string;
  readonly scenario: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly results: readonly TrialResult[];
}): RunSummary {
  const counts = {
    total: input.results.length,
    pass: input.results.filter((result) => result.status === "pass").length,
    fail: input.results.filter((result) => result.status === "fail").length,
    error: input.results.filter((result) => result.status === "error").length,
  };
  const predicates = input.results.flatMap((result) => result.predicates);
  const predicateCounts = {
    total: predicates.length,
    pass: predicates.filter((predicate) => predicate.status === "pass").length,
    fail: predicates.filter((predicate) => predicate.status === "fail").length,
    error:
      predicates.filter((predicate) => predicate.status === "error").length,
  };
  const status: EvaluationStatus = counts.error > 0
    ? "error"
    : counts.fail > 0
    ? "fail"
    : "pass";

  return {
    schemaVersion: 1,
    id: input.id,
    scenario: input.scenario,
    status,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs,
    counts,
    predicateCounts,
    results: input.results,
  };
}
