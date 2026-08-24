import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type {
  EvaluationPlan,
  ModelDefinition,
  RunSummary,
  TherapyConfig,
  TrialArtifacts,
  TrialResult,
} from "../domain.ts";
import { TherapyError } from "../domain.ts";
import { modelSlug } from "../plan.ts";
import type { ArtifactPort, RunArtifacts } from "../ports.ts";

async function writeJson(path: string, value: unknown): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await Deno.writeTextFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await Deno.rename(temporary, path);
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function digest(value: Uint8Array | string): Promise<string> {
  const bytes: Uint8Array<ArrayBuffer> = typeof value === "string"
    ? new TextEncoder().encode(value)
    : new Uint8Array(value);
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

async function copyTree(source: string, destination: string): Promise<void> {
  await Deno.mkdir(destination, { recursive: true });
  const entries = [];
  for await (const entry of Deno.readDir(source)) entries.push(entry);
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    const stat = entry.isSymlink ? await Deno.stat(sourcePath) : entry;
    if (stat.isDirectory) {
      await copyTree(sourcePath, destinationPath);
    } else if (stat.isFile) {
      await Deno.copyFile(sourcePath, destinationPath);
    }
  }
}

async function directoryDigest(root: string): Promise<string> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = [];
    for await (const entry of Deno.readDir(directory)) entries.push(entry);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory) await visit(path);
      else if (entry.isFile) files.push(path);
    }
  };
  await visit(root);
  const manifest = await Promise.all(files.map(async (path) => ({
    path: relative(root, path),
    sha256: await digest(await Deno.readFile(path)),
  })));
  return await digest(JSON.stringify(manifest));
}

function isCounts(value: unknown): boolean {
  return typeof value === "object" && value !== null &&
    "total" in value && typeof value.total === "number" &&
    "pass" in value && typeof value.pass === "number" &&
    "fail" in value && typeof value.fail === "number" &&
    "error" in value && typeof value.error === "number";
}

function isRunSummary(value: unknown): value is RunSummary {
  return typeof value === "object" && value !== null &&
    "schemaVersion" in value && value.schemaVersion === 1 &&
    "id" in value && typeof value.id === "string" &&
    "counts" in value && isCounts(value.counts) &&
    "predicateCounts" in value && isCounts(value.predicateCounts) &&
    "results" in value && Array.isArray(value.results);
}

export function createArtifactStore(root: string): ArtifactPort {
  return {
    async beginRun(plan: EvaluationPlan): Promise<RunArtifacts> {
      const runsRoot = resolve(root, plan.runs);
      await Deno.mkdir(runsRoot, { recursive: true });
      const runRoot = join(runsRoot, plan.id);
      try {
        await Deno.mkdir(runRoot, { recursive: false });
      } catch (error) {
        if (error instanceof Deno.errors.AlreadyExists) {
          throw new TherapyError(
            "run_exists",
            `Run artifact directory already exists: ${runRoot}`,
            error,
          );
        }
        throw error;
      }
      try {
        const inputsRoot = join(runRoot, "inputs");
        const systemPrompt = join(inputsRoot, "SYSTEM.md");
        const skill = join(inputsRoot, "marimo-pair");
        await Deno.mkdir(inputsRoot, { recursive: true });
        await Deno.copyFile(resolve(root, plan.systemPrompt), systemPrompt);
        await copyTree(await Deno.realPath(resolve(root, plan.skill)), skill);
        const systemPromptDigest = await digest(
          await Deno.readFile(systemPrompt),
        );
        const skillDigest = await directoryDigest(skill);
        await writeJson(join(runRoot, "plan.json"), {
          schemaVersion: 1,
          id: plan.id,
          scenario: plan.scenario.id,
          provider: plan.provider.id,
          models: plan.trials.map((trial) => trial.model.id),
          thinking: plan.thinking,
          timeoutMs: plan.timeoutMs,
          marimo: plan.marimo,
          inputs: {
            systemPrompt: {
              source: plan.systemPrompt,
              path: relative(runRoot, systemPrompt),
              sha256: systemPromptDigest,
            },
            skill: {
              source: plan.skill,
              path: relative(runRoot, skill),
              sha256: skillDigest,
            },
          },
        });
        return {
          root: runRoot,
          inputs: { systemPrompt, systemPromptDigest, skill, skillDigest },
        };
      } catch (error) {
        await Deno.remove(runRoot, { recursive: true }).catch(() => {});
        throw error;
      }
    },

    async beginTrial(
      run: RunArtifacts,
      model: ModelDefinition,
    ): Promise<TrialArtifacts> {
      const trialRoot = join(run.root, "models", modelSlug(model.id));
      const workspace = join(trialRoot, "workspace");
      const harness = join(trialRoot, "harness");
      await Deno.mkdir(workspace, { recursive: true });
      await Deno.mkdir(harness, { recursive: true });
      return {
        root: trialRoot,
        workspace,
        harness,
        marimoLog: join(trialRoot, "marimo.log"),
      };
    },

    async writeTrial(
      artifacts: TrialArtifacts,
      result: TrialResult,
    ): Promise<void> {
      await writeJson(join(artifacts.root, "result.json"), result);
    },

    async writeSummary(run: RunArtifacts, summary: RunSummary): Promise<void> {
      await writeJson(join(run.root, "summary.json"), summary);
    },

    async readSummary(
      pathOrId: string,
      config: TherapyConfig,
    ): Promise<RunSummary> {
      const candidate = isAbsolute(pathOrId)
        ? pathOrId
        : pathOrId.includes("/")
        ? resolve(root, pathOrId)
        : resolve(root, config.runs, pathOrId);
      let path = candidate;
      try {
        const stat = await Deno.stat(candidate);
        if (stat.isDirectory) path = join(candidate, "summary.json");
      } catch (error) {
        throw new TherapyError(
          "run_not_found",
          `Evaluation run was not found: ${pathOrId}`,
          error,
        );
      }

      let value: unknown;
      try {
        value = JSON.parse(await Deno.readTextFile(path));
      } catch (error) {
        throw new TherapyError(
          "invalid_run",
          `Could not read evaluation summary: ${path}`,
          error,
        );
      }
      if (!isRunSummary(value)) {
        throw new TherapyError(
          "invalid_run",
          `Evaluation summary has an unsupported shape: ${path}`,
        );
      }
      return value;
    },
  };
}
