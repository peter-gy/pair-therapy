import { assertEquals } from "@std/assert";

Deno.test("core modules keep runtime dependencies behind ports", async () => {
  const core = [
    "src/domain.ts",
    "src/ports.ts",
    "src/plan.ts",
    "src/evaluate.ts",
    "src/run.ts",
  ];
  const violations: string[] = [];
  for (const path of core) {
    const source = await Deno.readTextFile(path);
    if (/from ["']\.\/adapters\//.test(source)) {
      violations.push(`${path}: adapter import`);
    }
    if (/\bDeno\./.test(source)) {
      violations.push(`${path}: Deno runtime access`);
    }
    if (/from ["'](?:npm:|jsr:)/.test(source)) {
      violations.push(`${path}: package import`);
    }
  }

  assertEquals(violations, []);
});
