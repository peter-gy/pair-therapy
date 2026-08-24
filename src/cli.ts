import { parseArgs } from "@std/cli/parse-args";
import type { EvaluationPlan, RunSummary, TherapyConfig } from "./domain.ts";
import { TherapyError } from "./domain.ts";
import { createEvaluationPlan, validateConfig } from "./plan.ts";
import type {
  ArtifactPort,
  CatalogPort,
  ProgressEvent,
  RunArtifacts,
} from "./ports.ts";

const HELP = `Pair Therapy evaluates agent behavior in isolated Pi sessions.

Usage:
  deno task eval [scenario] [--model <id>]... [--output <directory>] [--json]
  deno task models [--json]
  deno task inspect -- <run-id-or-path> [--model <id>] [--json]

Commands:
  eval      Run one scenario. The configured default and all models are used when omitted.
  models    Check configured model IDs with one endpoint catalog request.
  inspect   Read a saved run summary.

Options:
  --model <id>          Select one model. Repeat to select several.
  --output <directory>  Write run artifacts under this directory. Default: runs.
  --json                Write the command result as JSON.

Environment:
  OPENAI_BASE       Base URL for the OpenAI-compatible API.
  OPENAI_API_KEY    API key for the endpoint.
`;

export interface CliIo {
  readonly out: (value: string) => void;
  readonly err: (value: string) => void;
}

export interface CliServices {
  readonly config: TherapyConfig;
  readonly catalog: CatalogPort;
  readonly artifacts: ArtifactPort;
  readonly run: (
    plan: EvaluationPlan,
    options?: {
      readonly signal?: AbortSignal;
      readonly progress?: (event: ProgressEvent) => void;
    },
  ) => Promise<
    { readonly summary: RunSummary; readonly artifacts: RunArtifacts }
  >;
}

export function createRunId(
  now = new Date(),
  randomId = crypto.randomUUID(),
): string {
  const timestamp = now.toISOString().replaceAll(":", "-").replace(".", "-");
  return `${timestamp}_${randomId.slice(0, 8)}`;
}

function failUnknown(option: string): boolean {
  if (!option.startsWith("-")) return true;
  throw new TherapyError("invalid_arguments", `Unknown option: ${option}`);
}

function positional(values: readonly (string | number)[]): string[] {
  return values.map(String);
}

function selectedModels(
  value: string | string[] | undefined,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.length === 0 ? undefined : value;
  return [value];
}

function renderProgress(event: ProgressEvent, io: CliIo): void {
  if (event.kind === "run_started") {
    io.err(
      `run ${event.runId}  ${event.total} trial(s)  ${event.artifactRoot}`,
    );
    return;
  }
  if (event.kind === "trial_started") {
    io.err(`[${event.ordinal + 1}/${event.total}] ${event.model}`);
    return;
  }
  io.err(
    `[${event.status.toUpperCase()}] ${event.model} ${
      (event.durationMs / 1_000).toFixed(1)
    }s`,
  );
}

function renderSummary(summary: RunSummary, artifactRoot: string): string {
  const lines = [
    `${summary.status.toUpperCase()} ${summary.scenario} ${summary.counts.pass}/${summary.counts.total} trials passed, ${summary.predicateCounts.pass}/${summary.predicateCounts.total} predicates passed`,
  ];
  for (const result of summary.results) {
    const detail = result.error?.message ??
      result.predicates.map((predicate) => predicate.message).join(" ");
    lines.push(`${result.status.toUpperCase()}\t${result.model}\t${detail}`);
  }
  lines.push(`artifacts\t${artifactRoot}`);
  return lines.join("\n");
}

function renderTrial(
  runId: string,
  result: RunSummary["results"][number],
): string {
  const detail = result.error?.message ??
    result.predicates.map((predicate) => predicate.message).join(" ");
  const lines = [
    `${result.status.toUpperCase()}\t${result.model}\t${detail}`,
    `run\t${runId}`,
  ];
  if (result.artifacts.session) {
    lines.push(`session\t${result.artifacts.session}`);
  }
  return lines.join("\n");
}

function exitCode(status: RunSummary["status"]): number {
  if (status === "pass") return 0;
  if (status === "fail") return 1;
  return 2;
}

async function evalCommand(
  args: string[],
  services: CliServices,
  io: CliIo,
  signal?: AbortSignal,
): Promise<number> {
  const parsed = parseArgs(args, {
    boolean: ["help", "json"],
    string: ["model", "output"],
    collect: ["model"],
    alias: { h: "help" },
    unknown: failUnknown,
  });
  if (parsed.help) {
    io.out(HELP.trimEnd());
    return 0;
  }
  const values = positional(parsed._);
  if (values.length > 1) {
    throw new TherapyError(
      "invalid_arguments",
      "eval accepts at most one scenario ID",
    );
  }
  const plan = createEvaluationPlan(services.config, {
    id: createRunId(),
    scenario: values[0],
    models: selectedModels(parsed.model),
    runs: parsed.output,
  });
  const result = await services.run(plan, {
    signal,
    progress: (event) => renderProgress(event, io),
  });
  io.out(
    parsed.json
      ? JSON.stringify(result.summary)
      : renderSummary(result.summary, result.artifacts.root),
  );
  return exitCode(result.summary.status);
}

async function modelsCommand(
  args: string[],
  services: CliServices,
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(args, {
    boolean: ["help", "json"],
    alias: { h: "help" },
    unknown: failUnknown,
  });
  if (parsed.help) {
    io.out(HELP.trimEnd());
    return 0;
  }
  if (parsed._.length > 0) {
    throw new TherapyError("invalid_arguments", "models accepts no arguments");
  }
  validateConfig(services.config);
  const models = await services.catalog.check(services.config.models);
  if (parsed.json) {
    io.out(JSON.stringify({ provider: services.config.provider.id, models }));
  } else {
    for (const model of models) {
      io.out(`${model.available ? "available" : "missing"}\t${model.id}`);
    }
  }
  return models.every((model) => model.available) ? 0 : 1;
}

async function inspectCommand(
  args: string[],
  services: CliServices,
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs(args, {
    boolean: ["help", "json"],
    string: ["model"],
    alias: { h: "help" },
    unknown: failUnknown,
  });
  if (parsed.help) {
    io.out(HELP.trimEnd());
    return 0;
  }
  const values = positional(parsed._);
  if (values.length !== 1) {
    throw new TherapyError(
      "invalid_arguments",
      "inspect requires one run ID or path",
    );
  }
  const summary = await services.artifacts.readSummary(
    values[0],
    services.config,
  );
  const result = parsed.model
    ? summary.results.find((candidate) => candidate.model === parsed.model)
    : undefined;
  if (parsed.model && !result) {
    throw new TherapyError(
      "unknown_model",
      `Run ${summary.id} has no result for model ${parsed.model}`,
    );
  }
  if (result) {
    io.out(
      parsed.json ? JSON.stringify(result) : renderTrial(summary.id, result),
    );
    return exitCode(result.status);
  }
  io.out(
    parsed.json ? JSON.stringify(summary) : renderSummary(summary, values[0]),
  );
  return exitCode(summary.status);
}

export async function runCli(
  args: string[],
  services: CliServices,
  io: CliIo = { out: console.log, err: console.error },
  signal?: AbortSignal,
): Promise<number> {
  try {
    const [command, ...rest] = args;
    if (
      !command || command === "help" || command === "--help" || command === "-h"
    ) {
      io.out(HELP.trimEnd());
      return 0;
    }
    const commandArgs = rest[0] === "--" ? rest.slice(1) : rest;
    if (command === "eval") {
      return await evalCommand(commandArgs, services, io, signal);
    }
    if (command === "models") {
      return await modelsCommand(commandArgs, services, io);
    }
    if (command === "inspect") {
      return await inspectCommand(commandArgs, services, io);
    }
    throw new TherapyError("unknown_command", `Unknown command: ${command}`);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    io.err(`pair-therapy: ${text}`);
    return error instanceof TherapyError && error.code === "aborted" ? 130 : 2;
  }
}
