# Pair Therapy

Pair Therapy is a model evaluation harness for
[marimo-pair](https://github.com/marimo-team/marimo-pair), the Agent Skill for
working inside running marimo notebook sessions. It runs scenario prompts
against configured models in isolated Pi sessions. Predicates evaluate native Pi
session logs and retain matching entry IDs as evidence.

## Run an evaluation

Pair Therapy requires Deno, uv, and an OpenAI-compatible endpoint. Create the
local environment file:

```bash
cp .env.example .env
```

```dotenv
OPENAI_BASE=http://localhost:8317/v1
OPENAI_API_KEY=sk-
```

Any OpenAI-compatible endpoint works. For a mixed catalog of open-weight model
endpoints, API-key providers, and OAuth-backed subscriptions, we recommend
[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) as a convenient
local aggregator.

From the Pair Therapy root, clone marimo-pair at the path expected by the
repository symlink:

```bash
git clone https://github.com/marimo-team/marimo-pair ../../marimo-pair
```

`.agents/skills/marimo-pair` uses that checkout as the skill under test.

Check the configured model IDs, then run one model:

```bash
deno task models
deno task eval help-cm --model gpt-5.6-luna
```

The result includes separate trial and predicate status:

```text
PASS help-cm 1/1 trials passed, 1/1 predicates passed
```

Run the default scenario across every configured model with:

```bash
deno task eval
```

## Configure the matrix

[`therapy.config.ts`](therapy.config.ts) defines the models, scenarios, thinking
level, timeouts, and marimo command. The uvx command accepts exact versions as
`marimo@VERSION`, `marimo@latest`, or uv's native `--from` form for a version
range.

## Inspect results

Each evaluation prints its run ID and writes artifacts under `runs/`. Set
`RUN_ID` to that value, then inspect the complete run or one model result:

```bash
deno task inspect -- "$RUN_ID"
deno task inspect -- "$RUN_ID" --model gpt-5.6-luna --json
```

Exit code `0` means every trial passed, `1` means a predicate failed, and `2`
means configuration, endpoint, harness, or runtime execution failed.

## Develop Pair Therapy

Read [Architecture](development_docs/architecture.md) for the core model, ports,
trial lifecycle, artifacts, and harness extension seam.

Run the repository checks with:

```bash
deno task check
```
