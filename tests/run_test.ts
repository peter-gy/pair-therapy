import { assertEquals } from "@std/assert";
import config from "../therapy.config.ts";
import type { TrialResult } from "../src/domain.ts";
import { createEvaluationPlan } from "../src/plan.ts";
import type { ArtifactPort, WorkspaceLease } from "../src/ports.ts";
import { createEvaluationRunner } from "../src/run.ts";

Deno.test("evaluation runner separates harness and predicate errors", async () => {
  const disposed: string[] = [];
  const written: TrialResult[] = [];
  const artifacts: ArtifactPort = {
    beginRun: () =>
      Promise.resolve({
        root: "/artifacts/run-1",
        inputs: {
          systemPrompt: "/artifacts/run-1/inputs/SYSTEM.md",
          systemPromptDigest: "system-digest",
          skill: "/artifacts/run-1/inputs/marimo-pair",
          skillDigest: "skill-digest",
        },
      }),
    beginTrial: (_run, model) =>
      Promise.resolve({
        root: `/artifacts/run-1/${model.id}`,
        workspace: `/artifacts/run-1/${model.id}/workspace`,
        harness: `/artifacts/run-1/${model.id}/harness`,
        marimoLog: `/artifacts/run-1/${model.id}/marimo.log`,
      }),
    writeTrial: (_paths, result) => {
      written.push(result);
      return Promise.resolve();
    },
    writeSummary: () => Promise.resolve(),
    readSummary: () => Promise.reject(new Error("unused")),
  };
  const times = [
    "2026-08-24T00:00:00Z",
    "2026-08-24T00:00:01Z",
    "2026-08-24T00:00:02Z",
    "2026-08-24T00:00:03Z",
  ].map((value) => new Date(value));
  const runner = createEvaluationRunner({
    catalog: {
      check: (models) =>
        Promise.resolve(
          models.map((model) => ({ id: model.id, available: true })),
        ),
    },
    workspace: {
      start: (_scenario, paths) => {
        const lease: WorkspaceLease = {
          url: "http://127.0.0.1:2718",
          cwd: paths.workspace,
          notebook: `${paths.workspace}/notebook.py`,
          dispose: () => {
            disposed.push(paths.workspace);
            return Promise.resolve();
          },
        };
        return Promise.resolve(lease);
      },
    },
    harness: {
      run: () =>
        Promise.resolve({
          log: { events: [] },
          session: "/artifacts/run-1/session.jsonl",
          error: { code: "provider_failed", message: "provider unavailable" },
        }),
    },
    artifacts,
    now: () => times.shift() ?? new Date("2026-08-24T00:00:03Z"),
  });
  const plan = createEvaluationPlan(config, {
    id: "run-1",
    models: ["gpt-5.6-sol"],
  });

  const { summary } = await runner(plan);

  assertEquals(summary.status, "error");
  assertEquals(summary.counts, { total: 1, pass: 0, fail: 0, error: 1 });
  assertEquals(summary.predicateCounts, {
    total: 1,
    pass: 0,
    fail: 0,
    error: 1,
  });
  assertEquals(written[0].error, {
    code: "provider_failed",
    message: "provider unavailable",
  });
  assertEquals(disposed, ["/artifacts/run-1/gpt-5.6-sol/workspace"]);
});
