import { assertEquals } from "@std/assert";
import config from "../therapy.config.ts";
import { createOpenAiCatalog } from "../src/adapters/openai.ts";

Deno.test("catalog adapter uses one models request", async () => {
  const requests: Request[] = [];
  const catalog = createOpenAiCatalog({
    provider: config.provider,
    readEnvironment: (name) =>
      name === "OPENAI_BASE" ? "http://router.example/v1" : "secret",
    fetch: (input, init) => {
      requests.push(new Request(input, init));
      return Promise.resolve(Response.json({
        data: [{ id: "gpt-5.6-sol" }],
      }));
    },
  });

  const result = await catalog.check(config.models.slice(0, 2));

  assertEquals(requests.length, 1);
  assertEquals(requests[0].url, "http://router.example/v1/models");
  assertEquals(result, [
    { id: "gpt-5.6-sol", available: true },
    { id: "gpt-5.6-terra", available: false },
  ]);
});
