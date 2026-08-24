import { basename, resolve } from "node:path";
import type { MarimoDefinition } from "../domain.ts";
import { TherapyError } from "../domain.ts";
import type { WorkspaceLease, WorkspacePort } from "../ports.ts";

const encoder = new TextEncoder();

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveDelay, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Evaluation aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new DOMException("Evaluation aborted", "AbortError"));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolveDelay();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function availablePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

async function activeSession(url: string): Promise<boolean> {
  const health = await fetch(`${url}/health`, {
    signal: AbortSignal.timeout(1_000),
  });
  if (!health.ok) return false;
  const sessions = await fetch(`${url}/api/sessions`, {
    signal: AbortSignal.timeout(1_000),
  });
  if (!sessions.ok) return false;
  const payload: unknown = await sessions.json();
  return typeof payload === "object" && payload !== null &&
    Object.keys(payload).length === 1;
}

async function waitForSession(input: {
  readonly url: string;
  readonly timeoutMs: number;
  readonly exited: () => boolean;
  readonly signal?: AbortSignal;
}): Promise<void> {
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    if (input.exited()) throw new Error("marimo exited during startup");
    if (input.signal?.aborted) {
      throw new DOMException("Evaluation aborted", "AbortError");
    }
    try {
      if (await activeSession(input.url)) return;
    } catch {
      // The server and browser session become reachable in separate startup phases.
    }
    await delay(200, input.signal);
  }
  throw new Error(
    `marimo did not expose one active session within ${input.timeoutMs}ms`,
  );
}

async function terminate(
  process: Deno.ChildProcess,
  status: Promise<Deno.CommandStatus>,
): Promise<void> {
  try {
    process.kill("SIGTERM");
  } catch {
    return;
  }
  const completed = await Promise.race([
    status.then(() => true),
    delay(5_000).then(() => false),
  ]);
  if (!completed) {
    try {
      process.kill("SIGKILL");
    } catch {
      return;
    }
    await status.catch(() => {});
  }
}

export function createMarimoWorkspace(input: {
  readonly root: string;
  readonly marimo: MarimoDefinition;
}): WorkspacePort {
  const [program, ...commandArguments] = input.marimo.command;
  const command = /[\\/]/.test(program)
    ? resolve(input.root, program)
    : program;

  return {
    async start(scenario, artifacts, signal): Promise<WorkspaceLease> {
      const fixture = resolve(input.root, scenario.workspace.fixture);
      const notebook = resolve(
        artifacts.workspace,
        scenario.workspace.notebook,
      );
      await Deno.copyFile(fixture, notebook);

      const port = availablePort();
      const url = `http://127.0.0.1:${port}`;
      const child = new Deno.Command(command, {
        args: [
          ...commandArguments,
          "edit",
          notebook,
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
          "--no-token",
          "--skip-update-check",
        ],
        cwd: artifacts.workspace,
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const status = child.status;
      let exited = false;
      void status.finally(() => exited = true);

      const log = await Deno.open(artifacts.marimoLog, {
        create: true,
        truncate: true,
        write: true,
      });
      const writer = log.writable.getWriter();
      let writes = Promise.resolve();
      const pump = async (
        label: string,
        stream: ReadableStream<Uint8Array>,
      ) => {
        writes = writes.then(() =>
          writer.write(encoder.encode(`[${label}]\n`))
        );
        for await (const chunk of stream) {
          writes = writes.then(() => writer.write(chunk));
        }
      };
      const pumps = [
        pump("stdout", child.stdout),
        pump("stderr", child.stderr),
      ];
      let disposed = false;
      const dispose = async () => {
        if (disposed) return;
        disposed = true;
        await terminate(child, status);
        await Promise.allSettled(pumps);
        await writes;
        await writer.close();
      };

      try {
        await waitForSession({
          url,
          timeoutMs: input.marimo.startupTimeoutMs,
          exited: () => exited,
          signal,
        });
      } catch (error) {
        await dispose();
        const output = await Deno.readTextFile(artifacts.marimoLog).catch(() =>
          ""
        );
        const tail = output.trim().split("\n").slice(-12).join("\n");
        throw new TherapyError(
          "marimo_start_failed",
          `Could not start ${basename(notebook)}: ${
            error instanceof Error ? error.message : String(error)
          }${tail ? `\n${tail}` : ""}`,
          error,
        );
      }

      return {
        url,
        cwd: artifacts.workspace,
        notebook,
        dispose,
      };
    },
  };
}
