import { join, resolve } from "node:path";
import { TherapyError } from "../domain.ts";

export const MARIMO_PAIR_CHECKOUT = "marimo-pair";
export const MARIMO_PAIR_REPO = "https://github.com/marimo-team/marimo-pair";

export type SkillCheckoutStatus = "present" | "cloned";

async function hasSkill(directory: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(join(directory, "SKILL.md"));
    return stat.isFile;
  } catch {
    return false;
  }
}

async function resolveSkill(
  root: string,
  skill: string,
): Promise<string | undefined> {
  try {
    return await Deno.realPath(resolve(root, skill));
  } catch {
    return undefined;
  }
}

async function defaultRunGit(
  args: readonly string[],
  cwd: string,
): Promise<void> {
  let result: Deno.CommandOutput;
  try {
    result = await new Deno.Command("git", {
      args: [...args],
      cwd,
      stdout: "piped",
      stderr: "piped",
    }).output();
  } catch (error) {
    throw new TherapyError(
      "skill_unavailable",
      "Could not clone marimo-pair. Install git and retry.",
      error,
    );
  }
  if (result.success) return;
  const stderr = new TextDecoder().decode(result.stderr).trim();
  throw new TherapyError(
    "skill_unavailable",
    stderr || "git clone of marimo-pair failed",
  );
}

export async function ensureMarimoPairCheckout(
  root: string,
  options: {
    readonly skill: string;
    readonly repo?: string;
    readonly runGit?: (
      args: readonly string[],
      cwd: string,
    ) => Promise<void>;
    readonly log?: (message: string) => void;
  },
): Promise<SkillCheckoutStatus> {
  const existing = await resolveSkill(root, options.skill);
  if (existing && await hasSkill(existing)) return "present";

  const checkout = resolve(root, MARIMO_PAIR_CHECKOUT);
  let checkoutExists = false;
  try {
    checkoutExists = (await Deno.stat(checkout)).isDirectory;
  } catch {
    checkoutExists = false;
  }

  if (!checkoutExists) {
    options.log?.(`Cloning marimo-pair into ${MARIMO_PAIR_CHECKOUT}`);
    await (options.runGit ?? defaultRunGit)(
      [
        "clone",
        "--depth",
        "1",
        options.repo ?? MARIMO_PAIR_REPO,
        MARIMO_PAIR_CHECKOUT,
      ],
      root,
    );
  }

  const resolved = await resolveSkill(root, options.skill);
  if (resolved && await hasSkill(resolved)) {
    return checkoutExists ? "present" : "cloned";
  }

  throw new TherapyError(
    "skill_unavailable",
    `marimo-pair is unavailable at ${resolve(root, options.skill)}. Clone ${
      options.repo ?? MARIMO_PAIR_REPO
    } into ${checkout}.`,
  );
}
