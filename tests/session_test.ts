import { assertEquals } from "@std/assert";
import type { SessionEntry } from "pi";
import { projectPiSession } from "../src/adapters/pi/session.ts";

Deno.test("projectPiSession keeps tool evidence and provider errors", () => {
  const entries = [
    {
      type: "message",
      id: "assistant-1",
      parentId: null,
      timestamp: "2026-08-24T00:00:00Z",
      message: {
        role: "assistant",
        content: [{
          type: "toolCall",
          id: "call-1",
          name: "bash",
          arguments: { command: "echo test" },
        }],
        stopReason: "toolUse",
      },
    },
    {
      type: "message",
      id: "result-1",
      parentId: "assistant-1",
      timestamp: "2026-08-24T00:00:01Z",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "bash",
        content: [{ type: "text", text: "test\n" }],
        isError: false,
      },
    },
    {
      type: "message",
      id: "assistant-2",
      parentId: "result-1",
      timestamp: "2026-08-24T00:00:02Z",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "provider unavailable",
      },
    },
  ] as unknown as SessionEntry[];

  assertEquals(projectPiSession(entries), {
    events: [
      {
        kind: "tool_call",
        sequence: 0,
        entryId: "assistant-1",
        toolCallId: "call-1",
        toolName: "bash",
        arguments: { command: "echo test" },
      },
      {
        kind: "tool_result",
        sequence: 1,
        entryId: "result-1",
        toolCallId: "call-1",
        toolName: "bash",
        output: "test\n",
        isError: false,
      },
      {
        kind: "assistant_error",
        sequence: 2,
        entryId: "assistant-2",
        message: "provider unavailable",
      },
    ],
  });
});
