import { assertEquals } from "@std/assert";
import config from "../therapy.config.ts";
import { type CliServices, runCli } from "../src/cli.ts";

Deno.test("models JSON is machine-readable and reports missing IDs", async () => {
  const output: string[] = [];
  const errors: string[] = [];
  const services: CliServices = {
    config,
    catalog: {
      check: (models) =>
        Promise.resolve(models.map((model, index) => ({
          id: model.id,
          available: index !== 1,
        }))),
    },
    artifacts: {
      beginRun: () => Promise.reject(new Error("unused")),
      beginTrial: () => Promise.reject(new Error("unused")),
      writeTrial: () => Promise.reject(new Error("unused")),
      writeSummary: () => Promise.reject(new Error("unused")),
      readSummary: () => Promise.reject(new Error("unused")),
    },
    run: () => Promise.reject(new Error("unused")),
  };

  const code = await runCli(
    ["models", "--json"],
    services,
    { out: (value) => output.push(value), err: (value) => errors.push(value) },
  );

  assertEquals(code, 1);
  assertEquals(errors, []);
  const payload = JSON.parse(output[0]);
  assertEquals(payload.provider, "local-openai");
  assertEquals(payload.models[1], {
    id: "gpt-5.6-terra",
    available: false,
  });
});

Deno.test("eval uses every configured model when model flags are omitted", async () => {
  let selected: string[] = [];
  const services: CliServices = {
    config,
    catalog: { check: () => Promise.resolve([]) },
    artifacts: {
      beginRun: () => Promise.reject(new Error("unused")),
      beginTrial: () => Promise.reject(new Error("unused")),
      writeTrial: () => Promise.reject(new Error("unused")),
      writeSummary: () => Promise.reject(new Error("unused")),
      readSummary: () => Promise.reject(new Error("unused")),
    },
    run: (plan) => {
      selected = plan.trials.map((trial) => trial.model.id);
      return Promise.resolve({
        summary: {
          schemaVersion: 1,
          id: plan.id,
          scenario: plan.scenario.id,
          status: "pass",
          startedAt: "2026-08-24T00:00:00Z",
          finishedAt: "2026-08-24T00:00:01Z",
          durationMs: 1_000,
          counts: { total: 0, pass: 0, fail: 0, error: 0 },
          predicateCounts: { total: 0, pass: 0, fail: 0, error: 0 },
          results: [],
        },
        artifacts: {
          root: "/runs/run-1",
          inputs: {
            systemPrompt: "/runs/run-1/inputs/SYSTEM.md",
            systemPromptDigest: "system-digest",
            skill: "/runs/run-1/inputs/marimo-pair",
            skillDigest: "skill-digest",
          },
        },
      });
    },
  };

  const code = await runCli(
    ["eval", "--json"],
    services,
    { out: () => {}, err: () => {} },
  );

  assertEquals(code, 0);
  assertEquals(selected, config.models.map((model) => model.id));
});

Deno.test("command separator is accepted before inspect arguments", async () => {
  const output: string[] = [];
  const services: CliServices = {
    config,
    catalog: { check: () => Promise.resolve([]) },
    artifacts: {
      beginRun: () => Promise.reject(new Error("unused")),
      beginTrial: () => Promise.reject(new Error("unused")),
      writeTrial: () => Promise.reject(new Error("unused")),
      writeSummary: () => Promise.reject(new Error("unused")),
      readSummary: () =>
        Promise.resolve({
          schemaVersion: 1,
          id: "run-1",
          scenario: "help-cm",
          status: "pass",
          startedAt: "2026-08-24T00:00:00Z",
          finishedAt: "2026-08-24T00:00:01Z",
          durationMs: 1_000,
          counts: { total: 0, pass: 0, fail: 0, error: 0 },
          predicateCounts: { total: 0, pass: 0, fail: 0, error: 0 },
          results: [],
        }),
    },
    run: () => Promise.reject(new Error("unused")),
  };

  const code = await runCli(
    ["inspect", "--", "run-1", "--json"],
    services,
    { out: (value) => output.push(value), err: () => {} },
  );

  assertEquals(code, 0);
  assertEquals(JSON.parse(output[0]).id, "run-1");
});

Deno.test("inspect model JSON returns one trial result", async () => {
  const output: string[] = [];
  const result = {
    scenario: "help-cm",
    model: "gpt-5.6-luna",
    status: "pass" as const,
    startedAt: "2026-08-24T00:00:00Z",
    finishedAt: "2026-08-24T00:00:01Z",
    durationMs: 1_000,
    predicates: [],
    artifacts: {
      session: "session.jsonl",
      workspace: "workspace",
      marimoLog: "marimo.log",
    },
  };
  const services: CliServices = {
    config,
    catalog: { check: () => Promise.resolve([]) },
    artifacts: {
      beginRun: () => Promise.reject(new Error("unused")),
      beginTrial: () => Promise.reject(new Error("unused")),
      writeTrial: () => Promise.reject(new Error("unused")),
      writeSummary: () => Promise.reject(new Error("unused")),
      readSummary: () =>
        Promise.resolve({
          schemaVersion: 1,
          id: "run-1",
          scenario: "help-cm",
          status: "fail",
          startedAt: "2026-08-24T00:00:00Z",
          finishedAt: "2026-08-24T00:00:02Z",
          durationMs: 2_000,
          counts: { total: 2, pass: 1, fail: 1, error: 0 },
          predicateCounts: { total: 1, pass: 1, fail: 0, error: 0 },
          results: [result],
        }),
    },
    run: () => Promise.reject(new Error("unused")),
  };

  const code = await runCli(
    ["inspect", "run-1", "--model", "gpt-5.6-luna", "--json"],
    services,
    { out: (value) => output.push(value), err: () => {} },
  );

  assertEquals(code, 0);
  assertEquals(JSON.parse(output[0]), result);
});
