import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import config from "../therapy.config.ts";
import { createArtifactStore } from "./adapters/artifacts.ts";
import { createMarimoWorkspace } from "./adapters/marimo.ts";
import { createOpenAiCatalog } from "./adapters/openai.ts";
import { createPiHarness } from "./adapters/pi/harness.ts";
import { type CliServices, runCli } from "./cli.ts";
import { createEvaluationRunner } from "./run.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function runtimeServices(): CliServices {
  const catalog = createOpenAiCatalog({ provider: config.provider });
  const artifacts = createArtifactStore(ROOT);
  return {
    config,
    catalog,
    artifacts,
    run: createEvaluationRunner({
      catalog,
      artifacts,
      workspace: createMarimoWorkspace({ root: ROOT, marimo: config.marimo }),
      harness: createPiHarness(),
    }),
  };
}

if (import.meta.main) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  Deno.addSignalListener("SIGINT", abort);
  try {
    Deno.exit(
      await runCli(Deno.args, runtimeServices(), undefined, controller.signal),
    );
  } finally {
    Deno.removeSignalListener("SIGINT", abort);
  }
}
