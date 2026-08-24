import { assertEquals, assertThrows } from "@std/assert";
import config from "../therapy.config.ts";
import { TherapyError } from "../src/domain.ts";
import {
  createEvaluationPlan,
  modelSlug,
  renderPrompt,
  validateConfig,
} from "../src/plan.ts";

Deno.test("createEvaluationPlan preserves requested model order", () => {
  const plan = createEvaluationPlan(config, {
    id: "run-1",
    models: ["gpt-5.6-luna", "gpt-5.6-sol"],
    runs: "/tmp/pair-therapy-runs",
  });

  assertEquals(
    plan.trials.map((trial) => trial.model.id),
    ["gpt-5.6-luna", "gpt-5.6-sol"],
  );
  assertEquals(plan.runs, "/tmp/pair-therapy-runs");
  assertEquals(plan.marimo.command, ["uvx", "marimo@0.24.0"]);
  assertEquals(
    renderPrompt(plan.scenario, "http://127.0.0.1:2718").includes(
      "http://127.0.0.1:2718",
    ),
    true,
  );
});

Deno.test("createEvaluationPlan rejects unknown models before side effects", () => {
  const error = assertThrows(
    () => createEvaluationPlan(config, { id: "run-1", models: ["unknown"] }),
    TherapyError,
  );
  assertEquals(error.code, "unknown_model");
});

Deno.test("createEvaluationPlan keeps run IDs in one artifact directory", () => {
  const error = assertThrows(
    () => createEvaluationPlan(config, { id: "nested/run" }),
    TherapyError,
  );
  assertEquals(error.code, "invalid_selection");
});

Deno.test("validateConfig rejects duplicate model IDs", () => {
  const duplicate = {
    ...config,
    models: [config.models[0], config.models[0]],
  };
  const error = assertThrows(() => validateConfig(duplicate), TherapyError);
  assertEquals(error.code, "invalid_config");
});

Deno.test("validateConfig rejects empty marimo command arguments", () => {
  const invalid = {
    ...config,
    marimo: { ...config.marimo, command: ["uvx", ""] as const },
  };
  const error = assertThrows(() => validateConfig(invalid), TherapyError);
  assertEquals(error.code, "invalid_config");
});

Deno.test("modelSlug keeps model IDs in one filesystem segment", () => {
  assertEquals(modelSlug("Qwen/Qwen3.8-27B"), "model-Qwen~2FQwen3.8-27B");
  assertEquals(modelSlug(".."), "model-..");
});
