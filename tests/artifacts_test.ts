import { basename, join } from "node:path";
import { assertEquals } from "@std/assert";
import config from "../therapy.config.ts";
import { createArtifactStore } from "../src/adapters/artifacts.ts";
import { createEvaluationPlan } from "../src/plan.ts";

Deno.test("artifact store freezes run inputs and records their digests", async () => {
  const root = await Deno.makeTempDir({ prefix: "pair-therapy-test-" });
  try {
    await Deno.writeTextFile(join(root, "SYSTEM.md"), "system v1\n");
    await Deno.mkdir(join(root, "skill", "scripts"), { recursive: true });
    await Deno.writeTextFile(join(root, "skill", "SKILL.md"), "skill v1\n");
    await Deno.writeTextFile(
      join(root, "skill", "scripts", "execute-code.sh"),
      "#!/bin/sh\n",
    );
    const localConfig = {
      ...config,
      systemPrompt: "SYSTEM.md",
      skill: "skill",
      runs: "runs",
    };
    const plan = createEvaluationPlan(localConfig, {
      id: "run-1",
      models: ["gpt-5.6-luna"],
    });
    const store = createArtifactStore(root);

    const run = await store.beginRun(plan);
    await Deno.writeTextFile(join(root, "skill", "SKILL.md"), "skill v2\n");
    const trial = await store.beginTrial(run, plan.trials[0].model);
    const manifest = JSON.parse(
      await Deno.readTextFile(join(run.root, "plan.json")),
    );

    assertEquals(
      await Deno.readTextFile(run.inputs.skill + "/SKILL.md"),
      "skill v1\n",
    );
    assertEquals(manifest.inputs.skill.sha256, run.inputs.skillDigest);
    assertEquals(
      manifest.inputs.systemPrompt.sha256,
      run.inputs.systemPromptDigest,
    );
    assertEquals(manifest.marimo.command, ["uvx", "marimo@0.24.0"]);
    assertEquals(basename(trial.harness), "harness");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
