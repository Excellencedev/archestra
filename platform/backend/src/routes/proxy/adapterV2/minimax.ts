import { encode as toonEncode } from "@toon-format/toon";
import { get } from "lodash-es";
import config from "@/config";
import { getObservableFetch } from "@/llm-metrics";
import logger from "@/logging";
import { TokenPriceModel } from "@/models";
import { getTokenizer } from "@/tokenizers";
import type {
  ChunkProcessingResult,
  CommonMcpToolDefinition,
  CommonMessage,
  CommonToolCall,
  CommonToolResult,
  CreateClientOptions,
  LLMProvider,
  LLMRequestAdapter,
  LLMResponseAdapter,
  LLMStreamAdapter,
  Minimax,
  StreamAccumulatorState,
  ToolCompressionStats,
  UsageView,
} from "@/types";
import { unwrapToolContent } from "../utils/unwrap-tool-content";

// =============================================================================
// TYPE ALIASES
// =============================================================================

type MinimaxRequest = Minimax.Types.ChatCompletionsRequest;
type MinimaxResponse = Minimax.Types.ChatCompletionsResponse;
type MinimaxMessages = Minimax.Types.ChatCompletionsRequest["messages"];
type MinimaxHeaders = Minimax.Types.ChatCompletionsHeaders;
type MinimaxStreamChunk = Minimax.Types.ChatCompletionChunk;

// =============================================================================
// MINIMAX SDK CLIENT
// =============================================================================

class MinimaxClient {
  private apiKey: string | undefined;
  private baseURL: string;
  private customFetch?: typeof fetch;

  constructor(
    apiKey: string | undefined,
    baseURL?: string,
    customFetch?: typeof fetch,
  ) {
    this.apiKey = apiKey;
    this.baseURL = baseURL || "https://api.minimax.io/v1";
    this.customFetch = customFetch;
  }

  async chatCompletions(request: MinimaxRequest): Promise<MinimaxResponse> {
    const fetchFn = this.customFetch || fetch;
    const response = await fetchFn(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
      },
      body: JSON.stringify({
        ...request,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `MiniMax API error: ${response.status} ${response.statusText}`;

      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error?.message) {
          errorMessage += ` - ${errorJson.error.message}`;
        } else {
          errorMessage += ` - ${errorText}`;
        }
      } catch {
        errorMessage += ` - ${errorText}`;
      }

      throw new Error(errorMessage);
    }

    return response.json() as Promise<MinimaxResponse>;
  }

  async chatCompletionsStream(
    request: MinimaxRequest,
  ): Promise<AsyncIterable<MinimaxStreamChunk>> {
    const fetchFn = this.customFetch || fetch;
    const response = await fetchFn(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
      },
      body: JSON.stringify({
        ...request,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `MiniMax API error: ${response.status} ${response.statusText}`;

      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error?.message) {
          errorMessage += ` - ${errorJson.error.message}`;
        } else {
          errorMessage += ` - ${errorText}`;
        }
      } catch {
        errorMessage += ` - ${errorText}`;
      }

      throw new Error(errorMessage);
    }

    return this.parseSSEStream(response);
  }

  private async *parseSSEStream(
    response: Response,
  ): AsyncIterable<MinimaxStreamChunk> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Response body is not readable");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;

          if (trimmed.startsWith("data: ")) {
            try {
              const jsonStr = trimmed.substring(6);
              const chunk = JSON.parse(jsonStr) as MinimaxStreamChunk;
              yield chunk;
            } catch (error) {
              logger.warn(
                { error, line: trimmed },
                "Failed to parse SSE chunk from MiniMax",
              );
            }
          }
        }
      }

      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith("data: ") && trimmed !== "data: [DONE]") {
          try {
            const jsonStr = trimmed.substring(6);
            const chunk = JSON.parse(jsonStr) as MinimaxStreamChunk;
            yield chunk;
          } catch (error) {
            logger.warn(
              { error, line: trimmed },
              "Failed to parse final SSE chunk from MiniMax",
            );
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

// =============================================================================
// REQUEST ADAPTER
// =============================================================================

class MinimaxRequestAdapter
  implements LLMRequestAdapter<MinimaxRequest, MinimaxMessages>
{
  readonly provider = "minimax" as const;
  private request: MinimaxRequest;
  private modifiedModel: string | null = null;
  private toolResultUpdates: Record<string, string> = {};

  constructor(request: MinimaxRequest) {
    this.request = request;
  }

  // ---------------------------------------------------------------------------
  // Read Access
  // ---------------------------------------------------------------------------

  getModel(): string {
    return this.modifiedModel ?? this.request.model;
  }

  isStreaming(): boolean {
    return this.request.stream === true;
  }

  getMessages(): CommonMessage[] {
    return this.toCommonFormat(this.request.messages);
  }

  getToolResults(): CommonToolResult[] {
    const results: CommonToolResult[] = [];

    for (const message of this.request.messages) {
      if (message.role === "tool") {
        const toolName = this.findToolNameInMessages(
          this.request.messages,
          message.tool_call_id,
        );

        let content: unknown;
        if (typeof message.content === "string") {
          try {
            content = JSON.parse(message.content);
          } catch {
            content = message.content;
          }
        } else {
          content = message.content;
        }

        results.push({
          id: message.tool_call_id,
          name: toolName ?? "unknown",
          content,
          isError: false,
        });
      }
    }

    return results;
  }

  getTools(): CommonMcpToolDefinition[] {
    if (!this.request.tools) return [];

    const result: CommonMcpToolDefinition[] = [];
    for (const tool of this.request.tools) {
      if (tool.type === "function") {
        result.push({
          name: tool.function.name,
          description: tool.function.description,
          inputSchema: tool.function.parameters as Record<string, unknown>,
        });
      }
    }
    return result;
  }

  hasTools(): boolean {
    return (this.request.tools?.length ?? 0) > 0;
  }

  getProviderMessages(): MinimaxMessages {
    return this.request.messages;
  }

  getOriginalRequest(): MinimaxRequest {
    return this.request;
  }

  // ---------------------------------------------------------------------------
  // Modify Access
  // ---------------------------------------------------------------------------

  setModel(model: string): void {
    this.modifiedModel = model;
  }

  updateToolResult(toolCallId: string, newContent: string): void {
    this.toolResultUpdates[toolCallId] = newContent;
  }

  applyToolResultUpdates(updates: Record<string, string>): void {
    Object.assign(this.toolResultUpdates, updates);
  }

  convertToolResultContent(messages: MinimaxMessages): MinimaxMessages {
    // MiniMax uses OpenAI-compatible format
    return messages;
  }

  async applyToonCompression(model: string): Promise<ToolCompressionStats> {
    const { messages: compressedMessages, stats } =
      await convertToolResultsToToon(this.request.messages, model);
    this.request = {
      ...this.request,
      messages: compressedMessages,
    };
    return stats;
  }

  // ---------------------------------------------------------------------------
  // Build Modified Request
  // ---------------------------------------------------------------------------

  toProviderRequest(): MinimaxRequest {
    let messages = this.request.messages;

    if (Object.keys(this.toolResultUpdates).length > 0) {
      messages = this.applyUpdates(messages, this.toolResultUpdates);
    }

    return {
      ...this.request,
      model: this.getModel(),
      messages,
    };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private findToolNameInMessages(
    messages: MinimaxMessages,
    toolCallId: string,
  ): string | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];

      if (message.role === "assistant" && message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          if (toolCall.id === toolCallId) {
            if (toolCall.type === "function") {
              return toolCall.function.name;
            }
          }
        }
      }
    }

    return null;
  }

  private toCommonFormat(messages: MinimaxMessages): CommonMessage[] {
    logger.debug(
      { messageCount: messages.length },
      "[MinimaxAdapter] toCommonFormat: starting conversion",
    );
    const commonMessages: CommonMessage[] = [];

    for (const message of messages) {
      const commonMessage: CommonMessage = {
        role: message.role as CommonMessage["role"],
      };

      if (message.role === "tool") {
        const toolName = this.findToolNameInMessages(
          messages,
          message.tool_call_id,
        );

        if (toolName) {
          logger.debug(
            { toolCallId: message.tool_call_id, toolName },
            "[MinimaxAdapter] toCommonFormat: found tool message",
          );
          let toolResult: unknown;
          if (typeof message.content === "string") {
            try {
              toolResult = JSON.parse(message.content);
            } catch {
              toolResult = message.content;
            }
          } else {
            toolResult = message.content;
          }

          commonMessage.toolCalls = [
            {
              id: message.tool_call_id,
              name: toolName,
              content: toolResult,
              isError: false,
            },
          ];
        }
      }

      commonMessages.push(commonMessage);
    }

    logger.debug(
      { inputCount: messages.length, outputCount: commonMessages.length },
      "[MinimaxAdapter] toCommonFormat: conversion complete",
    );
    return commonMessages;
  }

  private applyUpdates(
    messages: MinimaxMessages,
    updates: Record<string, string>,
  ): MinimaxMessages {
    const updateCount = Object.keys(updates).length;
    logger.debug(
      { messageCount: messages.length, updateCount },
      "[MinimaxAdapter] applyUpdates: starting",
    );

    if (updateCount === 0) {
      logger.debug("[MinimaxAdapter] applyUpdates: no updates to apply");
      return messages;
    }

    let appliedCount = 0;
    const result = messages.map((message) => {
      if (message.role === "tool" && updates[message.tool_call_id]) {
        appliedCount++;
        logger.debug(
          { toolCallId: message.tool_call_id },
          "[MinimaxAdapter] applyUpdates: applying update to tool message",
        );
        return {
          ...message,
          content: updates[message.tool_call_id],
        };
      }
      return message;
    });

    logger.debug(
      { updateCount, appliedCount },
      "[MinimaxAdapter] applyUpdates: complete",
    );
    return result;
  }
}

// =============================================================================
// RESPONSE ADAPTER
// =============================================================================

class MinimaxResponseAdapter implements LLMResponseAdapter<MinimaxResponse> {
  readonly provider = "minimax" as const;
  private response: MinimaxResponse;

  constructor(response: MinimaxResponse) {
    this.response = response;
  }

  getId(): string {
    return this.response.id;
  }

  getModel(): string {
    return this.response.model;
  }

  getText(): string {
    const choice = this.response.choices[0];
    if (!choice) return "";
    return choice.message.content ?? "";
  }

  getToolCalls(): CommonToolCall[] {
    const choice = this.response.choices[0];
    if (!choice?.message.tool_calls) return [];

    return choice.message.tool_calls.map((toolCall) => {
      let name: string;
      let args: Record<string, unknown>;

      if (toolCall.type === "function" && toolCall.function) {
        name = toolCall.function.name;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          args = {};
        }
      } else {
        name = "unknown";
        args = {};
      }

      return {
        id: toolCall.id,
        name,
        arguments: args,
      };
    });
  }

  hasToolCalls(): boolean {
    const choice = this.response.choices[0];
    return (choice?.message.tool_calls?.length ?? 0) > 0;
  }

  getUsage(): UsageView {
    return {
      inputTokens: this.response.usage?.prompt_tokens ?? 0,
      outputTokens: this.response.usage?.completion_tokens ?? 0,
    };
  }

  getOriginalResponse(): MinimaxResponse {
    return this.response;
  }

  toRefusalResponse(
    _refusalMessage: string,
    contentMessage: string,
  ): MinimaxResponse {
    return {
      ...this.response,
      choices: [
        {
          ...this.response.choices[0],
          message: {
            role: "assistant",
            content: contentMessage,
          },
          finish_reason: "stop",
        },
      ],
    };
  }
}

// =============================================================================
// STREAM ADAPTER
// =============================================================================

class MinimaxStreamAdapter
  implements LLMStreamAdapter<MinimaxStreamChunk, MinimaxResponse>
{
  readonly provider = "minimax" as const;
  readonly state: StreamAccumulatorState;
  private currentToolCallIndices = new Map<number, number>();

  constructor() {
    this.state = {
      responseId: "",
      model: "",
      text: "",
      toolCalls: [],
      rawToolCallEvents: [],
      usage: null,
      stopReason: null,
      timing: {
        startTime: Date.now(),
        firstChunkTime: null,
      },
    };
  }

  processChunk(chunk: MinimaxStreamChunk): ChunkProcessingResult {
    if (this.state.timing.firstChunkTime === null) {
      this.state.timing.firstChunkTime = Date.now();
    }

    let sseData: string | null = null;
    let isToolCallChunk = false;
    let isFinal = false;

    this.state.responseId = chunk.id;
    this.state.model = chunk.model;

    const choice = chunk.choices[0];
    if (!choice) {
      return {
        sseData: null,
        isToolCallChunk: false,
        isFinal: false,
      };
    }

    const delta = choice.delta;

    if (delta.content) {
      this.state.text += delta.content;
    }

    const hasContent = delta.content || delta.tool_calls || delta.role;

    if (hasContent) {
      sseData = `data: ${JSON.stringify(chunk)}\n\n`;
    }

    if (delta.tool_calls) {
      for (const toolCallDelta of delta.tool_calls) {
        const index = toolCallDelta.index;

        if (!this.currentToolCallIndices.has(index)) {
          this.currentToolCallIndices.set(index, this.state.toolCalls.length);
          this.state.toolCalls.push({
            id: toolCallDelta.id ?? "",
            name: toolCallDelta.function?.name ?? "",
            arguments: "",
          });
        }

        const toolCallIndex = this.currentToolCallIndices.get(index);
        if (toolCallIndex === undefined) continue;
        const toolCall = this.state.toolCalls[toolCallIndex];

        if (toolCallDelta.id) {
          toolCall.id = toolCallDelta.id;
        }
        if (toolCallDelta.function?.name) {
          toolCall.name = toolCallDelta.function.name;
        }
        if (toolCallDelta.function?.arguments) {
          toolCall.arguments += toolCallDelta.function.arguments;
        }
      }

      this.state.rawToolCallEvents.push(chunk);
      isToolCallChunk = true;
    }

    if (choice.finish_reason) {
      this.state.stopReason = choice.finish_reason;
      isFinal = true;
    }

    if (chunk.usage) {
      this.state.usage = {
        inputTokens: chunk.usage.prompt_tokens ?? 0,
        outputTokens: chunk.usage.completion_tokens ?? 0,
      };
    }

    return { sseData, isToolCallChunk, isFinal };
  }

  getSSEHeaders(): Record<string, string> {
    return {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    };
  }

  formatTextDeltaSSE(text: string): string {
    const chunk: MinimaxStreamChunk = {
      id: this.state.responseId,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: this.state.model,
      choices: [
        {
          index: 0,
          delta: {
            content: text,
          },
          finish_reason: null,
        },
      ],
    };
    return `data: ${JSON.stringify(chunk)}\n\n`;
  }

  getRawToolCallEvents(): string[] {
    return this.state.rawToolCallEvents.map(
      (event) => `data: ${JSON.stringify(event)}\n\n`,
    );
  }

  formatCompleteTextSSE(text: string): string[] {
    const chunk: MinimaxStreamChunk = {
      id: this.state.responseId || `chatcmpl-${Date.now()}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: this.state.model,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content: text,
          },
          finish_reason: null,
        },
      ],
    };
    return [`data: ${JSON.stringify(chunk)}\n\n`];
  }

  formatEndSSE(): string {
    const finalChunk: MinimaxStreamChunk = {
      id: this.state.responseId,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: this.state.model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: this.state.stopReason ?? "stop",
        },
      ],
    };
    return `data: ${JSON.stringify(finalChunk)}\n\ndata: [DONE]\n\n`;
  }

  toProviderResponse(): MinimaxResponse {
    const toolCalls =
      this.state.toolCalls.length > 0
        ? this.state.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: tc.arguments,
            },
          }))
        : undefined;

    return {
      id: this.state.responseId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: this.state.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: this.state.text || null,
            tool_calls: toolCalls,
          },
          finish_reason:
            (this.state.stopReason as Minimax.Types.FinishReason) ?? "stop",
        },
      ],
      usage: {
        prompt_tokens: this.state.usage?.inputTokens ?? 0,
        completion_tokens: this.state.usage?.outputTokens ?? 0,
        total_tokens:
          (this.state.usage?.inputTokens ?? 0) +
          (this.state.usage?.outputTokens ?? 0),
      },
    };
  }
}

// =============================================================================
// PROVIDER IMPLEMENTATION
// =============================================================================

export class MinimaxProvider
  implements
    LLMProvider<
      MinimaxRequest,
      MinimaxResponse,
      MinimaxStreamChunk,
      MinimaxMessages
    >
{
  readonly provider = "minimax" as const;

  createRequestAdapter(
    request: MinimaxRequest,
  ): LLMRequestAdapter<MinimaxRequest, MinimaxMessages> {
    return new MinimaxRequestAdapter(request);
  }

  createResponseAdapter(
    response: MinimaxResponse,
  ): LLMResponseAdapter<MinimaxResponse> {
    return new MinimaxResponseAdapter(response);
  }

  createStreamAdapter(): LLMStreamAdapter<MinimaxStreamChunk, MinimaxResponse> {
    return new MinimaxStreamAdapter();
  }

  async chatCompletions(
    request: MinimaxRequest,
    options?: CreateClientOptions,
  ): Promise<MinimaxResponse> {
    const client = new MinimaxClient(
      options?.apiKey,
      config.llm.minimax.baseUrl,
      options?.customFetch,
    );
    const observableFetch = getObservableFetch(
      client.chatCompletions.bind(client),
      {
        provider: "minimax",
        model: request.model,
      },
    );
    return observableFetch(request);
  }

  async chatCompletionsStream(
    request: MinimaxRequest,
    options?: CreateClientOptions,
  ): Promise<AsyncIterable<MinimaxStreamChunk>> {
    const client = new MinimaxClient(
      options?.apiKey,
      config.llm.minimax.baseUrl,
      options?.customFetch,
    );
    return client.chatCompletionsStream(request);
  }
}

export const minimaxProvider = new MinimaxProvider();

/**
 * Adapter Factory for MiniMax
 */
export const minimaxAdapterFactory: LLMProvider<
  MinimaxRequest,
  MinimaxResponse,
  MinimaxMessages,
  MinimaxStreamChunk,
  MinimaxHeaders
> = {
  provider: "minimax",
  interactionType: "minimax:chatCompletions",

  createRequestAdapter(
    request: MinimaxRequest,
  ): LLMRequestAdapter<MinimaxRequest, MinimaxMessages> {
    return new MinimaxRequestAdapter(request);
  },

  createResponseAdapter(
    response: MinimaxResponse,
  ): LLMResponseAdapter<MinimaxResponse> {
    return new MinimaxResponseAdapter(response);
  },

  createStreamAdapter(): LLMStreamAdapter<MinimaxStreamChunk, MinimaxResponse> {
    return new MinimaxStreamAdapter();
  },

  extractApiKey(headers: MinimaxHeaders): string | undefined {
    return headers.authorization;
  },

  getBaseUrl(): string | undefined {
    return config.llm.minimax.baseUrl;
  },

  getSpanName(): string {
    return "minimax.chat.completions";
  },

  createClient(
    apiKey: string | undefined,
    options?: CreateClientOptions,
  ): MinimaxClient {
    // Note: We don't have a mock client for MiniMax yet
    const customFetch = options?.agent
      ? getObservableFetch("minimax", options.agent, options.externalAgentId)
      : undefined;

    return new MinimaxClient(apiKey, options?.baseUrl, customFetch);
  },

  async execute(
    client: unknown,
    request: MinimaxRequest,
  ): Promise<MinimaxResponse> {
    const minimaxClient = client as MinimaxClient;
    return minimaxClient.chatCompletions(request);
  },

  async executeStream(
    client: unknown,
    request: MinimaxRequest,
  ): Promise<AsyncIterable<MinimaxStreamChunk>> {
    const minimaxClient = client as MinimaxClient;
    return minimaxClient.chatCompletionsStream(request);
  },

  extractErrorMessage(error: unknown): string {
    const minimaxMessage = get(error, "error.message");
    if (typeof minimaxMessage === "string") {
      return minimaxMessage;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return "Internal server error";
  },
};

/**
 * TOON result compression for MiniMax
 */
async function convertToolResultsToToon(
  messages: MinimaxMessages,
  model: string,
): Promise<{ messages: MinimaxMessages; stats: ToolCompressionStats }> {
  const stats: ToolCompressionStats = {
    originalBytes: 0,
    compressedBytes: 0,
    removedBytes: 0,
    compressedCount: 0,
    removedCount: 0,
  };

  const tokenizer = getTokenizer(model);

  const processedMessages = await Promise.all(
    messages.map(async (message) => {
      if (message.role !== "tool") return message;

      const originalContent =
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content);

      stats.originalBytes += originalContent.length;

      try {
        const parsedContent = JSON.parse(originalContent);
        const { content: compressedContent, wasCompressed } = await toonEncode(
          parsedContent,
          {
            tokenizer: (text) => tokenizer.encode(text),
            // MiniMax models have varied context windows, use reasonably conservative limit if unknown
            maxTokens: 4000,
          },
        );

        if (wasCompressed) {
          stats.compressedCount++;
          stats.compressedBytes += compressedContent.length;
          return { ...message, content: compressedContent };
        }
      } catch (e) {
        logger.warn(
          { error: e },
          "Failed to compress MiniMax tool result with TOON",
        );
      }

      stats.compressedBytes += originalContent.length;
      return message;
    }),
  );

  return { messages: processedMessages, stats };
}
