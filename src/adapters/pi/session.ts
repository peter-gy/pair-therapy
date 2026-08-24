import type { SessionEntry } from "pi";
import type {
  AssistantErrorEvent,
  EvaluationLog,
  ToolCallEvent,
  ToolResultEvent,
} from "../../domain.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content.flatMap((block) =>
    isRecord(block) && block.type === "text" && typeof block.text === "string"
      ? [block.text]
      : []
  ).join("\n");
}

export function projectPiSession(
  entries: readonly SessionEntry[],
): EvaluationLog {
  const events: (ToolCallEvent | ToolResultEvent | AssistantErrorEvent)[] = [];
  let sequence = 0;

  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message;

    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type !== "toolCall") continue;
        events.push({
          kind: "tool_call",
          sequence: sequence++,
          entryId: entry.id,
          toolCallId: block.id,
          toolName: block.name,
          arguments: isRecord(block.arguments) ? block.arguments : {},
        });
      }
      if (message.stopReason === "error") {
        events.push({
          kind: "assistant_error",
          sequence: sequence++,
          entryId: entry.id,
          message: message.errorMessage ?? "The model request failed",
        });
      }
      continue;
    }

    if (message.role === "toolResult") {
      events.push({
        kind: "tool_result",
        sequence: sequence++,
        entryId: entry.id,
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        output: textContent(message.content),
        isError: message.isError,
      });
    }
  }

  return { events };
}

export async function readPiSession(path: string): Promise<SessionEntry[]> {
  let source: string;
  try {
    source = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }

  return source.split("\n").flatMap((line, index) => {
    if (line.trim().length === 0) return [];
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid Pi session JSON on line ${index + 1}`, {
        cause: error,
      });
    }
    return isRecord(value) && value.type !== "session"
      ? [value as unknown as SessionEntry]
      : [];
  });
}
