import { join } from "node:path";
import { assertEquals, assertRejects } from "@std/assert";
import { TherapyError } from "../src/domain.ts";
import {
  ensureMarimoPairCheckout,
  MARIMO_PAIR_CHECKOUT,
  MARIMO_PAIR_REPO,
} from "../src/adapters/skill.ts";

async function writeSkill(root: string, skill: string): Promise<void> {
  const directory = join(root, skill);
  await Deno.mkdir(directory, { recursive: true });
  await Deno.writeTextFile(join(directory, "SKILL.md"), "# skill\n");
}

Deno.test("ensureMarimoPairCheckout skips git when the skill is already present", async () => {
  const root = await Deno.makeTempDir({ prefix: "pair-therapy-skill-" });
  try {
    await writeSkill(root, "skill");
    let cloned = false;
    const status = await ensureMarimoPairCheckout(root, {
      skill: "skill",
      runGit: () => {
        cloned = true;
        return Promise.resolve();
      },
    });
    assertEquals(status, "present");
    assertEquals(cloned, false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureMarimoPairCheckout clones marimo-pair when the skill is missing", async () => {
  const root = await Deno.makeTempDir({ prefix: "pair-therapy-skill-" });
  try {
    const logs: string[] = [];
    const status = await ensureMarimoPairCheckout(root, {
      skill: join(MARIMO_PAIR_CHECKOUT, "skills", "marimo-pair"),
      log: (message) => logs.push(message),
      runGit: async (args, cwd) => {
        assertEquals(cwd, root);
        assertEquals(args, [
          "clone",
          "--depth",
          "1",
          MARIMO_PAIR_REPO,
          MARIMO_PAIR_CHECKOUT,
        ]);
        await writeSkill(
          root,
          join(MARIMO_PAIR_CHECKOUT, "skills", "marimo-pair"),
        );
      },
    });
    assertEquals(status, "cloned");
    assertEquals(logs, [`Cloning marimo-pair into ${MARIMO_PAIR_CHECKOUT}`]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureMarimoPairCheckout reports a missing skill after a failed checkout", async () => {
  const root = await Deno.makeTempDir({ prefix: "pair-therapy-skill-" });
  try {
    const error = await assertRejects(
      () =>
        ensureMarimoPairCheckout(root, {
          skill: "missing-skill",
          runGit: () => Promise.resolve(),
        }),
      TherapyError,
    );
    assertEquals(error.code, "skill_unavailable");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
