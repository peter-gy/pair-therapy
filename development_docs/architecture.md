# Architecture

Pair Therapy separates evaluation policy from the processes that execute it.
Scenarios and predicates depend on a compact session projection. Runtime
adapters own endpoint requests, marimo kernels, Pi sessions, and files.

```text
therapy.config.ts
  -> evaluation plan
  -> trial runner
       -> workspace port
       -> harness port
       -> predicates
       -> artifact port
  -> run summary
```

## Core model

`therapy.config.ts` defines the provider, model catalog, scenarios, timeouts,
and marimo command vector. `createEvaluationPlan()` validates a requested
scenario and model selection before any network or filesystem work begins.

Each `Scenario` contains:

- an ID and prompt template
- a notebook fixture copied into each trial workspace
- predicates that consume an `EvaluationLog`

The Pi session projector keeps tool calls, tool results, and assistant errors.
Predicates use those events and return a status, explanation, and evidence
references into the canonical session JSONL.

## Ports and adapters

| Port            | Contract                                               | Current adapter                 |
| --------------- | ------------------------------------------------------ | ------------------------------- |
| `CatalogPort`   | Check configured model IDs                             | OpenAI-compatible `GET /models` |
| `WorkspacePort` | Start and dispose one live notebook workspace          | Configured command subprocess   |
| `HarnessPort`   | Run one model and return its session projection        | Pi RPC subprocess               |
| `ArtifactPort`  | Freeze inputs and persist plans, trials, and summaries | Local filesystem                |

Core modules depend on domain types and these ports. `src/main.ts` is the
composition root that selects the concrete adapters.

## Trial lifecycle

One evaluation follows this sequence:

1. Check selected model IDs with one catalog request.
2. Snapshot `SYSTEM.md` and the `marimo-pair` skill checkout. Record SHA-256
   digests and the configured marimo command in `plan.json`.
3. For each model, create a fresh fixture workspace and harness directory.
4. Start a live notebook workspace from the scenario fixture. The configured
   marimo command owns Python selection, package resolution, environment
   isolation, and caching.
5. Start Pi with the frozen skill, frozen system prompt, selected model, and
   run-local agent directory. Native `/skill:name` expansion loads the skill
   body into the model context.
6. Project the Pi session into `EvaluationLog`, evaluate predicates, and write
   the trial result.
7. Dispose the spawned workspace process before starting the next model.

Trials run sequentially. Pi automatic retry and compaction are disabled, and
unrelated parent environment values are blanked before the Pi subprocess starts.
A provider failure remains separate from any predicate result supported by
session evidence.

## Artifacts

```text
runs/<run-id>/
  plan.json
  summary.json
  inputs/
    SYSTEM.md
    marimo-pair/
  models/<encoded-model-id>/
    result.json
    marimo.log
    workspace/notebook.py
    harness/session.jsonl
    harness/agent/models.json
```

`harness/session.jsonl` is the canonical transcript. `result.json` stores one
model's trial status, predicate results, evidence IDs, usage, final text, and
artifact paths. `summary.json` reports trial health and predicate outcomes as
separate counts.

## Add another harness

A harness integration is a vertical adapter:

1. Implement `HarnessPort`.
2. Write native runtime state beneath the trial's generic `harness/` directory.
3. Return an `EvaluationLog` and canonical session path.
4. Select the adapter in the composition root.

Scenarios, predicates, planning, workspace management, and summary rendering
remain unchanged.

## Validate a change

Run the complete static and unit boundary:

```bash
deno task check
```

Changes to marimo startup, Pi RPC, session projection, or process disposal also
need a live single-model evaluation:

```bash
deno task eval help-cm --model gpt-5.6-luna
```
