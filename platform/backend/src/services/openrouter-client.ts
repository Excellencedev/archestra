import logger from "@/logging";

/**
 * OpenRouter model metadata structure
 * Based on https://openrouter.ai/docs/guides/overview/models
 */
export interface OpenRouterModel {
  id: string;
  canonical_slug: string;
  name: string;
  created: number;
  description: string;
  context_length: number;
  architecture: {
    input_modalities: string[]; // ["text", "image", "file"]
    output_modalities: string[]; // ["text"]
    tokenizer: string;
    instruct_type: string | null;
  };
  pricing: {
    prompt: string;
    completion: string;
    request: string;
    image: string;
  };
  top_provider: {
    context_length: number;
    max_completion_tokens: number;
    is_moderated: boolean;
  };
  supported_parameters: string[];
}

export interface OpenRouterResponse {
  data: OpenRouterModel[];
}

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/models";

/**
 * Fetch all models from OpenRouter API
 * @returns Array of OpenRouter model metadata
 * @throws Error if API request fails
 */
export async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  try {
    logger.debug("Fetching models from OpenRouter API");

    const response = await fetch(OPENROUTER_API_URL, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { status: response.status, error: errorText },
        "Failed to fetch OpenRouter models",
      );
      throw new Error(
        `Failed to fetch OpenRouter models: ${response.status}`,
      );
    }

    const data = (await response.json()) as OpenRouterResponse;

    if (!data.data || !Array.isArray(data.data)) {
      logger.error(
        { responseKeys: Object.keys(data) },
        "Invalid OpenRouter response format",
      );
      throw new Error("Invalid OpenRouter response format");
    }

    logger.info(
      { modelCount: data.data.length },
      "Successfully fetched OpenRouter models",
    );

    return data.data;
  } catch (error) {
    logger.error({ error }, "Error fetching OpenRouter models");
    throw error;
  }
}

/**
 * Extract capabilities from OpenRouter model metadata
 * Analyzes input_modalities, output_modalities, and supported_parameters
 * to determine model capabilities
 *
 * Capability detection rules:
 * - Vision: input_modalities includes "image" or "file"
 * - Function Calling: supported_parameters includes "tools" or "functions"
 * - Reasoning: model description or ID contains "reasoning"
 * - Image Generation: output_modalities includes "image"
 */
export function extractCapabilities(model: OpenRouterModel): string[] {
  const capabilities: string[] = [];

  try {
    // Check for vision capability
    if (
      model.architecture?.input_modalities?.includes("image") ||
      model.architecture?.input_modalities?.includes("file")
    ) {
      capabilities.push("vision");
    }

    // Check for function calling capability
    if (
      model.supported_parameters?.includes("tools") ||
      model.supported_parameters?.includes("functions")
    ) {
      capabilities.push("function_calling");
    }

    // Check for reasoning capability
    const descriptionLower = model.description?.toLowerCase() || "";
    const idLower = model.id?.toLowerCase() || "";
    if (
      descriptionLower.includes("reasoning") ||
      idLower.includes("reasoning")
    ) {
      capabilities.push("reasoning");
    }

    // Check for image generation capability
    if (model.architecture?.output_modalities?.includes("image")) {
      capabilities.push("image_generation");
    }
  } catch (error) {
    logger.warn(
      { modelId: model.id, error },
      "Error extracting capabilities from model",
    );
  }

  return capabilities;
}
