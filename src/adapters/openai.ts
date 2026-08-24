import type { ModelDefinition, ProviderDefinition } from "../domain.ts";
import { TherapyError } from "../domain.ts";
import type { CatalogPort, ModelAvailability } from "../ports.ts";

export interface ProviderEnvironment {
  readonly baseUrl: string;
  readonly apiKey: string;
}

type EnvironmentReader = (name: string) => string | undefined;

export function readProviderEnvironment(
  provider: ProviderDefinition,
  readEnvironment: EnvironmentReader = (name) => Deno.env.get(name),
): ProviderEnvironment {
  const baseUrl = readEnvironment(provider.baseUrlEnv);
  if (!baseUrl) {
    throw new TherapyError(
      "missing_environment",
      `${provider.baseUrlEnv} must be set in .env or the process environment`,
    );
  }
  const apiKey = readEnvironment(provider.apiKeyEnv);
  if (!apiKey) {
    throw new TherapyError(
      "missing_environment",
      `${provider.apiKeyEnv} must be set in .env or the process environment`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch (error) {
    throw new TherapyError(
      "invalid_environment",
      `${provider.baseUrlEnv} must be a valid URL`,
      error,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TherapyError(
      "invalid_environment",
      `${provider.baseUrlEnv} must use http or https`,
    );
  }

  return { baseUrl, apiKey };
}

function catalogEndpoint(baseUrl: string): URL {
  return new URL("models", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
}

function readModelIds(payload: unknown): Set<string> {
  if (
    typeof payload !== "object" || payload === null ||
    !("data" in payload) || !Array.isArray(payload.data)
  ) {
    throw new TherapyError(
      "invalid_catalog",
      "The model catalog response must contain a data array",
    );
  }
  return new Set(
    payload.data.flatMap((item) =>
      typeof item === "object" && item !== null && "id" in item &&
        typeof item.id === "string"
        ? [item.id]
        : []
    ),
  );
}

export function createOpenAiCatalog(input: {
  readonly provider: ProviderDefinition;
  readonly fetch?: typeof globalThis.fetch;
  readonly readEnvironment?: EnvironmentReader;
  readonly timeoutMs?: number;
}): CatalogPort {
  const fetcher = input.fetch ?? globalThis.fetch;
  const timeoutMs = input.timeoutMs ?? 10_000;

  return {
    async check(
      models: readonly ModelDefinition[],
    ): Promise<readonly ModelAvailability[]> {
      const environment = readProviderEnvironment(
        input.provider,
        input.readEnvironment,
      );
      const endpoint = catalogEndpoint(environment.baseUrl);
      let response: Response;
      try {
        response = await fetcher(endpoint, {
          headers: { authorization: `Bearer ${environment.apiKey}` },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new TherapyError(
          "catalog_request_failed",
          `GET ${endpoint} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error,
        );
      }
      if (!response.ok) {
        throw new TherapyError(
          "catalog_request_failed",
          `GET ${endpoint} returned ${response.status} ${response.statusText}`,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw new TherapyError(
          "invalid_catalog",
          `GET ${endpoint} returned invalid JSON`,
          error,
        );
      }
      const ids = readModelIds(payload);
      return models.map((model) => ({
        id: model.id,
        available: ids.has(model.id),
      }));
    },
  };
}
