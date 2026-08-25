import { helpCmScenario } from "./scenarios/help-cm/scenario.ts";
import type { TherapyConfig } from "./src/domain.ts";

const models = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "Qwen/Qwen3.8-27B",
  "MiniMaxAI/MiniMax-M3",
  "deepseek-ai/DeepSeek-V4-Pro",
  "stealth/ox-alpha",
  "openai/gpt-oss-120b",
].map((id) => ({
  id,
  reasoning: true,
  input: ["text", "image"] as const,
}));

export default {
  provider: {
    id: "local-openai",
    api: "openai-responses",
    baseUrlEnv: "OPENAI_BASE",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  models,
  thinking: "medium",
  timeoutMs: 180_000,
  systemPrompt: "SYSTEM.md",
  skill: "marimo-pair/skills/marimo-pair",
  runs: "runs",
  marimo: {
    command: ["uvx", "marimo@0.24.0"],
    startupTimeoutMs: 45_000,
  },
  defaultScenario: "help-cm",
  scenarios: [helpCmScenario],
} satisfies TherapyConfig;
