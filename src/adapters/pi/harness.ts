import { dirname, resolve } from "node:path";
import { RpcClient, type SessionEntry } from "pi";
import type { Failure, UsageSummary } from "../../domain.ts";
import { TherapyError } from "../../domain.ts";
import type { HarnessPort, HarnessRun } from "../../ports.ts";
import { readProviderEnvironment } from "../openai.ts";
import { isolateEnvironment } from "./environment.ts";
import { projectPiSession, readPiSession } from "./session.ts";

const PI_CLI = new URL("./cli.js", import.meta.resolve("pi")).pathname;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function writeProviderCatalog(input: {
  readonly path: string;
  readonly baseUrl: string;
  readonly apiKeyEnv: string;
  readonly plan: Parameters<HarnessPort["run"]>[0]["plan"];
}): Promise<void> {
  const provider = input.plan.provider;
  const value = {
    providers: {
      [provider.id]: {
        baseUrl: input.baseUrl,
        api: provider.api,
        apiKey: `$${input.apiKeyEnv}`,
        models: input.plan.models.map((model) => ({
          id: model.id,
          reasoning: model.reasoning,
          input: model.input,
          compat: model.reasoning
            ? { supportsReasoningEffort: true }
            : undefined,
        })),
      },
    },
  };
  await Deno.mkdir(dirname(input.path), { recursive: true });
  await Deno.writeTextFile(input.path, `${JSON.stringify(value, null, 2)}\n`);
}

async function existingEntries(
  client: RpcClient,
  sessionPath: string,
): Promise<SessionEntry[]> {
  try {
    return (await client.getEntries()).entries;
  } catch {
    return await readPiSession(sessionPath);
  }
}

function assistantFailure(
  entries: readonly SessionEntry[],
): Failure | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (
      entry.type === "message" && entry.message.role === "assistant" &&
      entry.message.stopReason === "error"
    ) {
      return {
        code: "model_request_failed",
        message: entry.message.errorMessage ?? "The model request failed",
      };
    }
  }
  return undefined;
}

function usageSummary(
  stats: Awaited<ReturnType<RpcClient["getSessionStats"]>>,
): UsageSummary {
  return {
    input: stats.tokens.input,
    output: stats.tokens.output,
    cacheRead: stats.tokens.cacheRead,
    cacheWrite: stats.tokens.cacheWrite,
    total: stats.tokens.total,
    cost: stats.cost,
  };
}

export function createPiHarness(input: {
  readonly environment?: () => Record<string, string>;
  readonly cliPath?: string;
} = {}): HarnessPort {
  const environment = input.environment ?? (() => Deno.env.toObject());
  const cliPath = input.cliPath ?? PI_CLI;

  return {
    async run(runInput): Promise<HarnessRun> {
      const providerEnvironment = readProviderEnvironment(
        runInput.plan.provider,
      );
      const systemPromptPath = runInput.run.inputs.systemPrompt;
      const skillPath = runInput.run.inputs.skill;
      const agentPath = resolve(runInput.artifacts.harness, "agent");
      const sessionPath = resolve(runInput.artifacts.harness, "session.jsonl");
      const systemPrompt = await Deno.readTextFile(systemPromptPath);
      try {
        await Deno.stat(resolve(skillPath, "SKILL.md"));
      } catch (error) {
        throw new TherapyError(
          "skill_unavailable",
          `marimo-pair is unavailable at ${skillPath}`,
          error,
        );
      }

      await writeProviderCatalog({
        path: resolve(agentPath, "models.json"),
        baseUrl: providerEnvironment.baseUrl,
        apiKeyEnv: runInput.plan.provider.apiKeyEnv,
        plan: runInput.plan,
      });

      const provider = runInput.plan.provider.id;
      const model = runInput.model.id;
      const client = new RpcClient({
        cliPath,
        cwd: runInput.workspace.cwd,
        env: {
          ...isolateEnvironment(environment()),
          [runInput.plan.provider.baseUrlEnv]: providerEnvironment.baseUrl,
          [runInput.plan.provider.apiKeyEnv]: providerEnvironment.apiKey,
          PI_CODING_AGENT_DIR: agentPath,
          PI_OFFLINE: "1",
          NO_COLOR: "1",
        },
        provider,
        model,
        args: [
          "--session",
          sessionPath,
          "--no-skills",
          "--skill",
          skillPath,
          "--no-extensions",
          "--no-prompt-templates",
          "--no-context-files",
          "--no-themes",
          "--system-prompt",
          systemPrompt,
          "--thinking",
          runInput.plan.thinking,
          "--models",
          `${provider}/${model}`,
          "--tools",
          "read,bash",
          "--no-approve",
        ],
      });

      let entries: SessionEntry[] = [];
      let failure: Failure | undefined;
      let finalText: string | undefined;
      let usage: UsageSummary | undefined;
      let removeAbortListener = () => {};

      try {
        await client.start();
        const state = await client.getState();
        if (state.model?.provider !== provider || state.model.id !== model) {
          throw new TherapyError(
            "model_selection_failed",
            `Pi selected ${state.model?.provider}/${state.model?.id}, expected ${provider}/${model}`,
          );
        }
        const skillCommands = (await client.getCommands()).filter((command) =>
          command.source === "skill"
        );
        if (skillCommands.length !== 1) {
          throw new TherapyError(
            "skill_invocation_failed",
            `Pi exposed ${skillCommands.length} skill commands, expected one`,
          );
        }
        const prompt = `/${
          skillCommands[0].name
        } Skill directory for this run: ${skillPath}\n\n${runInput.prompt}`;
        await client.setAutoRetry(false);
        await client.setAutoCompaction(false);

        if (runInput.signal) {
          const abort = () => void client.abort().catch(() => {});
          runInput.signal.addEventListener("abort", abort, { once: true });
          removeAbortListener = () =>
            runInput.signal?.removeEventListener("abort", abort);
        }
        if (runInput.signal?.aborted) {
          throw new TherapyError("aborted", "Evaluation aborted");
        }

        try {
          await client.promptAndWait(
            prompt,
            undefined,
            runInput.plan.timeoutMs,
          );
        } catch (error) {
          await client.abort().catch(() => {});
          failure = {
            code: runInput.signal?.aborted ? "aborted" : "harness_failed",
            message: message(error),
          };
        }

        entries = await existingEntries(client, sessionPath);
        finalText = (await client.getLastAssistantText().catch(() => null)) ??
          undefined;
        const stats = await client.getSessionStats().catch(() => undefined);
        usage = stats ? usageSummary(stats) : undefined;
        failure ??= assistantFailure(entries);
      } catch (error) {
        if (error instanceof TherapyError) throw error;
        throw new TherapyError(
          "pi_failed",
          `Pi failed for ${model}: ${message(error)}`,
          error,
        );
      } finally {
        removeAbortListener();
        await client.stop().catch(() => {});
      }

      if (entries.length === 0) {
        entries = await readPiSession(sessionPath);
      }
      return {
        log: projectPiSession(entries),
        session: sessionPath,
        finalText,
        usage,
        error: failure,
      };
    },
  };
}
