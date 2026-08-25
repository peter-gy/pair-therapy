import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import config from "../therapy.config.ts";
import { ensureMarimoPairCheckout } from "./adapters/skill.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

if (import.meta.main) {
  const status = await ensureMarimoPairCheckout(ROOT, {
    skill: config.skill,
    log: (message) => console.error(message),
  });
  if (status === "present") {
    console.error("marimo-pair is already available");
  }
}
