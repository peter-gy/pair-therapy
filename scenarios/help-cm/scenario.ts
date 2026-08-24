import type {
  EvaluationLog,
  EvidenceRef,
  Predicate,
  ToolCallEvent,
  ToolResultEvent,
} from "../../src/domain.ts";

const HELP_CALL =
  /(?:^|[;\n])\s*help\s*\(\s*cm\s*\)\s*(?=$|[;#\n"'])|(?:-c\s+["'])\s*help\s*\(\s*cm\s*\)\s*(?=["'])/m;
const CM_API_CALL = /\bcm\s*\.\s*[A-Za-z_]\w*\s*\(/m;
const HELP_OUTPUT = /Help on (?:module|package) marimo\._code_mode/;

interface Execution {
  readonly call: ToolCallEvent;
  readonly result?: ToolResultEvent;
  readonly command: string;
}

function executions(log: EvaluationLog): readonly Execution[] {
  const results = new Map(
    log.events
      .filter((event): event is ToolResultEvent => event.kind === "tool_result")
      .map((event) => [event.toolCallId, event]),
  );

  return log.events
    .filter((event): event is ToolCallEvent => event.kind === "tool_call")
    .flatMap((call) => {
      const command = call.arguments.command;
      if (
        call.toolName !== "bash" ||
        typeof command !== "string" ||
        !/execute-code\.sh\b/.test(command)
      ) {
        return [];
      }
      return [{ call, result: results.get(call.toolCallId), command }];
    });
}

function ref(execution: Execution, excerpt: string): EvidenceRef[] {
  const evidence: EvidenceRef[] = [{
    entryId: execution.call.entryId,
    sequence: execution.call.sequence,
    toolCallId: execution.call.toolCallId,
    excerpt,
  }];
  if (execution.result) {
    evidence.push({
      entryId: execution.result.entryId,
      sequence: execution.result.sequence,
      toolCallId: execution.result.toolCallId,
      excerpt: execution.result.isError
        ? "tool result: error"
        : "tool result: success",
    });
  }
  return evidence;
}

export const helpCmBeforeContext: Predicate = {
  id: "help-cm-before-api",
  description: "Calls help(cm) in the live kernel before another cm API.",
  evaluate(log) {
    const observed = executions(log);
    const firstApi = observed.find((execution) =>
      CM_API_CALL.test(execution.command)
    );
    const firstHelp = observed.find((execution) => {
      if (!HELP_CALL.test(execution.command)) return false;
      return HELP_OUTPUT.test(execution.result?.output ?? "");
    });

    if (!firstHelp) {
      return {
        id: this.id,
        status: "fail",
        message: "No completed live-kernel execution called help(cm).",
        evidence: firstApi ? ref(firstApi, "first observed cm API call") : [],
      };
    }

    if (firstApi) {
      const helpPosition = firstHelp.command.search(HELP_CALL);
      const apiPosition = firstApi.command.search(CM_API_CALL);
      const helpComesFirst = firstHelp.call.sequence < firstApi.call.sequence ||
        (firstHelp.call.sequence === firstApi.call.sequence &&
          helpPosition < apiPosition);
      if (!helpComesFirst) {
        return {
          id: this.id,
          status: "fail",
          message: "The first cm API call preceded help(cm).",
          evidence: [
            ...ref(firstApi, "first observed cm API call"),
            ...ref(firstHelp, "first completed help(cm) call"),
          ],
        };
      }
    }

    return {
      id: this.id,
      status: "pass",
      message: firstApi
        ? "The live kernel completed help(cm) before another cm API."
        : "The live kernel completed help(cm).",
      evidence: ref(firstHelp, "first completed help(cm) call"),
    };
  },
};

export const helpCmScenario = {
  id: "help-cm",
  title: "Inspect code mode before context access",
  prompt: [
    "Use the loaded marimo-pair skill to connect to {{notebookUrl}}.",
    "Inspect the live notebook's cell metadata and report the number of cells and their IDs.",
    "Keep the notebook unchanged.",
  ].join(" "),
  workspace: {
    fixture: "scenarios/help-cm/notebook.py",
    notebook: "notebook.py",
  },
  predicates: [helpCmBeforeContext],
} as const;
