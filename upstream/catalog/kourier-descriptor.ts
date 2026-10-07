import type { ProviderDescriptor } from "@oh-my-pi/catalog/provider-models/descriptor-types";
import { createSimpleOpenAICompletionsOptions } from "@oh-my-pi/catalog/provider-models/openai-compat";

/** Proposed first-party Kourier model-discovery descriptor for oh-my-pi. */
export const kourierDescriptor = {
  providerId: "kourier",
  defaultModel: "deepseek-v4.1-flash",
  dynamicModelsAuthoritative: true,
  createModelManagerOptions(config) {
    return createSimpleOpenAICompletionsOptions("kourier", "https://api.kourier.sh/v1", config);
  },
} satisfies ProviderDescriptor;
