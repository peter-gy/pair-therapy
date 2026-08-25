import { assertEquals, assertRejects } from "@std/assert";
import type { Failure } from "../src/domain.ts";
import {
  closeSocket,
  editArguments,
  holdSession,
  isKernelReadyMessage,
  SESSION_ID,
  sessionSocketUrl,
} from "../src/adapters/marimo.ts";

Deno.test("editArguments starts a headless edit server without a browser", () => {
  assertEquals(editArguments("/tmp/notebook.py", 2718), [
    "edit",
    "/tmp/notebook.py",
    "--host",
    "127.0.0.1",
    "--port",
    "2718",
    "--headless",
    "--no-token",
    "--no-skew-protection",
    "--skip-update-check",
  ]);
});

Deno.test("sessionSocketUrl targets the held kernel session", () => {
  assertEquals(
    sessionSocketUrl("http://127.0.0.1:60353"),
    `ws://127.0.0.1:60353/ws?session_id=${SESSION_ID}`,
  );
  assertEquals(
    sessionSocketUrl("https://example.test:8443/", "custom"),
    "wss://example.test:8443/ws?session_id=custom",
  );
});

Deno.test("isKernelReadyMessage accepts the kernel-ready handshake", () => {
  assertEquals(
    isKernelReadyMessage(JSON.stringify({ op: "kernel-ready", cell_ids: [] })),
    true,
  );
  assertEquals(
    isKernelReadyMessage(JSON.stringify({ op: "completed-run" })),
    false,
  );
  assertEquals(isKernelReadyMessage("not-json"), false);
});

type SocketMode = "ready" | "hang" | "close-before-ready" | "reject-first";

async function withFakeMarimo(
  mode: SocketMode,
  run: (url: string, sockets: WebSocket[]) => Promise<void>,
): Promise<void> {
  const sockets: WebSocket[] = [];
  let attempts = 0;
  const stop = new AbortController();
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    signal: stop.signal,
  }, (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/health") return new Response("ok");
    if (path === "/api/sessions") {
      return Response.json({
        [SESSION_ID]: { filename: "notebook.py", path: "notebook.py" },
      });
    }
    if (path !== "/ws") return new Response("not found", { status: 404 });
    attempts += 1;
    if (mode === "hang") {
      return new Promise<Response>((resolve) => {
        stop.signal.addEventListener(
          "abort",
          () => resolve(new Response("stopped", { status: 503 })),
          { once: true },
        );
      });
    }
    if (mode === "reject-first" && attempts === 1) {
      return new Response("no", { status: 400 });
    }
    const { socket, response } = Deno.upgradeWebSocket(request);
    sockets.push(socket);
    socket.addEventListener("open", () => {
      if (mode === "close-before-ready") {
        socket.close();
        return;
      }
      socket.send(JSON.stringify({ op: "kernel-ready" }));
    });
    return response;
  });
  const address = server.addr as Deno.NetAddr;
  try {
    await run(`http://127.0.0.1:${address.port}`, sockets);
  } finally {
    stop.abort();
    await server.shutdown();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.test("holdSession waits for kernel-ready on a headless websocket", async () => {
  await withFakeMarimo("ready", async (url) => {
    const held = await holdSession({ url, timeoutMs: 2_000 });
    try {
      assertEquals(held.socket.readyState, WebSocket.OPEN);
    } finally {
      held.release();
      await closeSocket(held.socket);
    }
  });
});

Deno.test("holdSession retries a failed websocket open then holds the session", async () => {
  await withFakeMarimo("reject-first", async (url) => {
    const held = await holdSession({ url, timeoutMs: 2_000 });
    try {
      assertEquals(held.socket.readyState, WebSocket.OPEN);
    } finally {
      held.release();
      await closeSocket(held.socket);
    }
  });
});

Deno.test("holdSession times out a websocket that never opens", async () => {
  await withFakeMarimo("hang", async (url) => {
    await assertRejects(
      () => holdSession({ url, timeoutMs: 300 }),
      Error,
      "session socket",
    );
  });
});

Deno.test("holdSession aborts a websocket that never opens", async () => {
  await withFakeMarimo("hang", async (url) => {
    const signal = AbortSignal.timeout(100);
    await assertRejects(
      () => holdSession({ url, timeoutMs: 5_000, signal }),
      DOMException,
      "aborted",
    );
  });
});

Deno.test("holdSession fails when the socket closes before kernel-ready", async () => {
  await withFakeMarimo("close-before-ready", async (url) => {
    await assertRejects(
      () => holdSession({ url, timeoutMs: 2_000 }),
      Error,
      "kernel-ready",
    );
  });
});

Deno.test("holdSession reports an unexpected close during the trial", async () => {
  await withFakeMarimo("ready", async (url, sockets) => {
    const held = await holdSession({ url, timeoutMs: 2_000 });
    try {
      sockets[0].close();
      const lost = await held.failed;
      assertEquals(lost.code, "marimo_session_lost");
    } finally {
      held.release();
      await closeSocket(held.socket);
    }
  });
});

Deno.test("holdSession dispose does not report a released socket as lost", async () => {
  await withFakeMarimo("ready", async (url) => {
    const held = await holdSession({ url, timeoutMs: 2_000 });
    held.release();
    await closeSocket(held.socket);
    const outcome = await Promise.race([
      held.failed.then((lost: Failure) => lost.code),
      delay(50).then(() => "held"),
    ]);
    assertEquals(outcome, "held");
  });
});
