import { assertEquals } from "@std/assert";
import { isolateEnvironment } from "../src/adapters/pi/environment.ts";

Deno.test("Pi child environment blanks unrelated parent values", () => {
  const isolated = isolateEnvironment({
    PATH: "/usr/bin",
    HOME: "/home/test",
    AWS_SECRET_ACCESS_KEY: "secret",
    DATABASE_URL: "postgres://secret",
  });

  assertEquals(isolated.PATH, "/usr/bin");
  assertEquals(isolated.HOME, "/home/test");
  assertEquals(isolated.AWS_SECRET_ACCESS_KEY, "");
  assertEquals(isolated.DATABASE_URL, "");
});
