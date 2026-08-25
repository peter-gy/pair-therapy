import { basename, resolve } from "node:path";
import type { Failure, MarimoDefinition } from "../domain.ts";
import { TherapyError } from "../domain.ts";
import type { WorkspaceLease, WorkspacePort } from "../ports.ts";

const encoder = new TextEncoder();
export const SESSION_ID = "pair-therapy";

function abortError(): DOMException {
  return new DOMException("Evaluation aborted", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveDelay, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortError());
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

export function editArguments(notebook: string, port: number): string[] {
  return [
    "edit",
    notebook,
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--headless",
    "--no-token",
    "--no-skew-protection",
    "--skip-update-check",
  ];
}

export function sessionSocketUrl(
  httpUrl: string,
  sessionId = SESSION_ID,
): string {
  const url = new URL("/ws", httpUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("session_id", sessionId);
  return url.href;
}

export function isKernelReadyMessage(data: string): boolean {
  try {
    const message: unknown = JSON.parse(data);
    return typeof message === "object" && message !== null &&
      "op" in message && message.op === "kernel-ready";
  } catch {
    return false;
  }
}

async function healthy(url: string): Promise<boolean> {
  const health = await fetch(`${url}/health`, {
    signal: AbortSignal.timeout(1_000),
  });
  return health.ok;
}

async function activeSession(url: string): Promise<boolean> {
  if (!await healthy(url)) return false;
  const sessions = await fetch(`${url}/api/sessions`, {
    signal: AbortSignal.timeout(1_000),
  });
  if (!sessions.ok) return false;
  const payload: unknown = await sessions.json();
  return typeof payload === "object" && payload !== null &&
    Object.keys(payload).length === 1;
}

async function waitUntil(
  input: {
    readonly ready: () => Promise<boolean>;
    readonly timeoutMs: number;
    readonly exited: () => boolean;
    readonly signal?: AbortSignal;
    readonly message: string;
  },
): Promise<void> {
  const deadline = Date.now() + input.timeoutMs;
  while (true) {
    if (input.exited()) throw new Error("marimo exited during startup");
    if (input.signal?.aborted) throw abortError();
    try {
      if (await input.ready()) return;
    } catch {
      // Health, the held websocket, and /api/sessions come up in stages.
    }
    if (Date.now() >= deadline) throw new Error(input.message);
    await delay(200, input.signal);
  }
}

function remainingMs(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

export function closeSocket(socket: WebSocket | undefined): Promise<void> {
  if (!socket || socket.readyState === WebSocket.CLOSED) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, 1_000);
    socket.addEventListener("close", finish, { once: true });
    try {
      socket.close();
    } catch {
      finish();
    }
  });
}

function openSessionSocket(
  httpUrl: string,
  deadline: number,
  signal?: AbortSignal,
): Promise<{ socket: WebSocket; ready: Promise<void> }> {
  const url = sessionSocketUrl(httpUrl);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    let settled = false;
    const socket = new WebSocket(url);
    const finish = (action: () => void, close: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      const settle = () => action();
      if (close) {
        void closeSocket(socket).then(settle, settle);
        return;
      }
      settle();
    };
    const onAbort = () => finish(() => reject(abortError()), true);
    const onOpen = () => {
      finish(
        () => resolve({ socket, ready: watchKernelReady(socket) }),
        false,
      );
    };
    const onError = () =>
      finish(
        () =>
          reject(new Error(`Could not open marimo session socket at ${url}`)),
        true,
      );
    const timeout = setTimeout(
      () =>
        finish(
          () =>
            reject(
              new Error(`Could not open marimo session socket at ${url}`),
            ),
          true,
        ),
      remainingMs(deadline),
    );
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.addEventListener("open", onOpen, { once: true });
    socket.addEventListener("error", onError, { once: true });
  });
}

async function connectSessionSocket(input: {
  readonly url: string;
  readonly deadline: number;
  readonly exited: () => boolean;
  readonly signal?: AbortSignal;
}): Promise<{ socket: WebSocket; ready: Promise<void> }> {
  while (Date.now() < input.deadline) {
    if (input.exited()) throw new Error("marimo exited during startup");
    if (input.signal?.aborted) throw abortError();
    try {
      return await openSessionSocket(input.url, input.deadline, input.signal);
    } catch (error) {
      if (isAbortError(error)) throw error;
    }
    await delay(200, input.signal);
  }
  throw new Error("marimo session socket did not accept a connection in time");
}

function watchKernelReady(socket: WebSocket): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  let settled = false;
  const onMessage = (event: MessageEvent) => {
    if (typeof event.data === "string" && isKernelReadyMessage(event.data)) {
      finish(() => resolve());
    }
  };
  const onClose = () =>
    finish(() =>
      reject(new Error("marimo session socket closed before kernel-ready"))
    );
  const finish = (action: () => void) => {
    if (settled) return;
    settled = true;
    socket.removeEventListener("message", onMessage);
    socket.removeEventListener("close", onClose);
    action();
  };
  socket.addEventListener("message", onMessage);
  socket.addEventListener("close", onClose);
  return promise;
}

function waitForKernelReady(input: {
  readonly ready: Promise<void>;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}): Promise<void> {
  if (input.signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = () => finish(() => reject(abortError()));
    const timeout = setTimeout(
      () =>
        finish(() =>
          reject(
            new Error(
              `marimo kernel was not ready within ${input.timeoutMs}ms`,
            ),
          )
        ),
      input.timeoutMs,
    );
    input.signal?.addEventListener("abort", onAbort, { once: true });
    input.ready.then(
      () => finish(() => resolve()),
      (error) => finish(() => reject(error)),
    );
  });
}

function watchSessionLoss(socket: WebSocket): {
  failed: Promise<Failure>;
  release: () => void;
} {
  const { promise, resolve } = Promise.withResolvers<Failure>();
  let released = false;
  const lose = (message: string) => {
    if (released) return;
    released = true;
    socket.removeEventListener("close", onClose);
    socket.removeEventListener("error", onError);
    resolve({ code: "marimo_session_lost", message });
  };
  const onClose = () => lose("marimo session socket closed during the trial");
  const onError = () => lose("marimo session socket failed during the trial");
  socket.addEventListener("close", onClose);
  socket.addEventListener("error", onError);
  return {
    failed: promise,
    release: () => {
      if (released) return;
      released = true;
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
    },
  };
}

export interface HeldSession {
  readonly socket: WebSocket;
  readonly failed: Promise<Failure>;
  release(): void;
}

export async function holdSession(input: {
  readonly url: string;
  readonly timeoutMs: number;
  readonly exited?: () => boolean;
  readonly signal?: AbortSignal;
}): Promise<HeldSession> {
  const exited = input.exited ?? (() => false);
  const deadline = Date.now() + input.timeoutMs;
  await waitUntil({
    ready: () => healthy(input.url),
    timeoutMs: input.timeoutMs,
    exited,
    signal: input.signal,
    message: `marimo did not become healthy within ${input.timeoutMs}ms`,
  });
  const { socket, ready } = await connectSessionSocket({
    url: input.url,
    deadline,
    exited,
    signal: input.signal,
  });
  try {
    await waitForKernelReady({
      ready,
      timeoutMs: remainingMs(deadline),
      signal: input.signal,
    });
    await waitUntil({
      ready: () => activeSession(input.url),
      timeoutMs: remainingMs(deadline),
      exited,
      signal: input.signal,
      message:
        `marimo did not expose one active session within ${input.timeoutMs}ms`,
    });
  } catch (error) {
    await closeSocket(socket);
    throw error;
  }
  const loss = watchSessionLoss(socket);
  return {
    socket,
    failed: loss.failed,
    release: loss.release,
  };
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
        args: [...commandArguments, ...editArguments(notebook, port)],
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
      let session: HeldSession | undefined;
      let disposed = false;
      const dispose = async () => {
        if (disposed) return;
        disposed = true;
        session?.release();
        await closeSocket(session?.socket);
        session = undefined;
        await terminate(child, status);
        await Promise.allSettled(pumps);
        await writes;
        await writer.close();
      };

      try {
        session = await holdSession({
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
        failed: session.failed,
        dispose,
      };
    },
  };
}
