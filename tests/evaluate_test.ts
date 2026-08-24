import { assertEquals } from "@std/assert";
import { helpCmBeforeContext } from "../scenarios/help-cm/scenario.ts";
import type {
  EvaluationLog,
  ToolCallEvent,
  ToolResultEvent,
} from "../src/domain.ts";

function execution(
  command: string,
  options: { readonly isError?: boolean; readonly output?: string } = {},
): EvaluationLog {
  const call: ToolCallEvent = {
    kind: "tool_call",
    sequence: 0,
    entryId: "assistant-1",
    toolCallId: "call-1",
    toolName: "bash",
    arguments: { command },
  };
  const result: ToolResultEvent = {
    kind: "tool_result",
    sequence: 1,
    entryId: "result-1",
    toolCallId: "call-1",
    toolName: "bash",
    output: options.output ?? "",
    isError: options.isError ?? false,
  };
  return { events: [call, result] };
}

const script =
  "bash /skill/scripts/execute-code.sh --url http://localhost:2718 -";

Deno.test("help-cm predicate accepts a completed call before context access", () => {
  const log = execution(
    `${script} <<'PY'\nimport marimo._code_mode as cm\nhelp(cm)\nasync with cm.get_context() as ctx:\n    print(len(ctx.cells))\nPY`,
    { output: "Help on package marimo._code_mode in marimo:\n" },
  );

  const result = helpCmBeforeContext.evaluate(log);

  assertEquals(result.status, "pass");
  assertEquals(result.evidence.map((item) => item.entryId), [
    "assistant-1",
    "result-1",
  ]);
});

Deno.test("help-cm predicate rejects context access before help", () => {
  const log = execution(
    `${script} <<'PY'\nimport marimo._code_mode as cm\nasync with cm.get_context() as ctx:\n    print(len(ctx.cells))\nhelp(cm)\nPY`,
  );

  assertEquals(helpCmBeforeContext.evaluate(log).status, "fail");
});

Deno.test("help-cm predicate ignores commands that read matching text", () => {
  const log = execution("rg 'help\\(cm\\)' /skill/SKILL.md");

  assertEquals(helpCmBeforeContext.evaluate(log).status, "fail");
});

Deno.test("help-cm predicate accepts help output when later code fails", () => {
  const log = execution(
    `${script} <<'PY'\nimport marimo._code_mode as cm\nhelp(cm)\nraise RuntimeError('later')\nPY`,
    {
      isError: true,
      output: "Help on module marimo._code_mode in marimo:\n",
    },
  );

  assertEquals(helpCmBeforeContext.evaluate(log).status, "pass");
});

Deno.test("help-cm predicate accepts a quoted dash-c command", () => {
  const log = execution(
    'bash /skill/scripts/execute-code.sh --url http://localhost:2718 -c "import marimo._code_mode as cm; help(cm)"',
    { output: "Help on package marimo._code_mode in marimo:\n" },
  );

  assertEquals(helpCmBeforeContext.evaluate(log).status, "pass");
});

Deno.test("help-cm predicate accepts direct helper execution", () => {
  const log = execution(
    '/snapshot/scripts/execute-code.sh --url http://localhost:2718 -c "import marimo._code_mode as cm; help(cm)"',
    { output: "Help on package marimo._code_mode in marimo:\n" },
  );

  assertEquals(helpCmBeforeContext.evaluate(log).status, "pass");
});

Deno.test("help-cm predicate requires recognizable help output", () => {
  const log = execution(
    `${script} <<'PY'\nimport marimo._code_mode as cm\nif False:\n    help(cm)\nPY`,
  );

  assertEquals(helpCmBeforeContext.evaluate(log).status, "fail");
});

Deno.test("help-cm predicate rejects another cm API before help", () => {
  const log = execution(
    `${script} <<'PY'\nimport marimo._code_mode as cm\ncm.capabilities()\nhelp(cm)\nPY`,
    { output: "Help on package marimo._code_mode in marimo:\n" },
  );

  assertEquals(helpCmBeforeContext.evaluate(log).status, "fail");
});
