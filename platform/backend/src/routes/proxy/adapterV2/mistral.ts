import { encode as toonEncode } from "@toon-format/toon";
import OpenAIProvider from "openai";
import config from "@/config";
import { getObservableFetch } from "@/llm-metrics";
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
  Mistral,
  StreamAccumulatorState,
  ToonCompressionResult,
  UsageView,
} from "@/types";
import type { CompressionStats } from "../utils/toon-conversion";
import { unwrapToolContent } from "../utils/unwrap-tool-content";

// =============================================================================
// TYPE ALIASES (Using Mistral-specific types where they differ, otherwise OpenAI)
// =============================================================================

type MistralRequest = Mistral.Types.ChatCompletionsRequest;
type MistralResponse = Mistral.Types.ChatCompletionsResponse;
type MistralMessages = Mistral.Types.ChatCompletionsRequest["messages"];
type MistralHeaders = Mistral.Types.ChatCompletionsHeaders;
type MistralStreamChunk = Mistral.Types.ChatCompletionChunk;

// =============================================================================
// REQUEST ADAPTER
// =============================================================================

class MistralRequestAdapter
  implements LLMRequestAdapter<MistralRequest, MistralMessages>
{
  readonly provider = "mistral" as const;
  private request: MistralRequest;
  private modifiedModel: string | null = null;
  private toolResultUpdates: Record<string, string> = {};

  constructor(request: MistralRequest) {
    this.request = request;
  }

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

  getProviderMessages(): MistralMessages {
    return this.request.messages;
  }

  getOriginalRequest(): MistralRequest {
    return this.request;
  }

  setModel(model: string): void {
    this.modifiedModel = model;
  }

  updateToolResult(toolCallId: string, newContent: string): void {
    this.toolResultUpdates[toolCallId] = newContent;
  }

  applyToolResultUpdates(updates: Record<string, string>): void {
    Object.assign(this.toolResultUpdates, updates);
  }

  async applyToonCompression(model: string): Promise<ToonCompressionResult> {
    const { messages: compressedMessages, stats } =
      await convertToolResultsToToon(this.request.messages, model);
    this.request = {
      ...this.request,
      messages: compressedMessages,
    };
    return {
      tokensBefore: stats.toonTokensBefore,
      tokensAfter: stats.toonTokensAfter,
      costSavings: stats.toonCostSavings,
    };
  }

  convertToolResultContent(messages: MistralMessages): MistralMessages {
    return messages;
  }

  toProviderRequest(): MistralRequest {
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

  private findToolNameInMessages(
    messages: MistralMessages,
    toolCallId: string,
  ): string | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];

      if (message.role === "assistant" && message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          if (toolCall.id === toolCallId) {
            return toolCall.function.name;
          }
        }
      }
    }

    return null;
  }

  private toCommonFormat(messages: MistralMessages): CommonMessage[] {
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

    return commonMessages;
  }

  private applyUpdates(
    messages: MistralMessages,
    updates: Record<string, string>,
  ): MistralMessages {
    if (Object.keys(updates).length === 0) {
      return messages;
    }

    const result = messages.map((message) => {
      if (message.role === "tool" && updates[message.tool_call_id]) {
        return {
          ...message,
          content: updates[message.tool_call_id],
        };
      }
      return message;
    });

    return result;
  }
}

// =============================================================================
// RESPONSE ADAPTER
// =============================================================================

class MistralResponseAdapter implements LLMResponseAdapter<MistralResponse> {
  readonly provider = "mistral" as const;
  private response: MistralResponse;

  constructor(response: MistralResponse) {
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
    return choice.message.content || "";
  }

  getToolCalls(): CommonToolCall[] {
    const choice = this.response.choices[0];
    if (!choice?.message.tool_calls) return [];

    return choice.message.tool_calls.map((toolCall) => {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = {};
      }

      return {
        id: toolCall.id,
        name: toolCall.function.name,
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

  getOriginalResponse(): MistralResponse {
    return this.response;
  }

  toRefusalResponse(
    _refusalMessage: string,
    contentMessage: string,
  ): MistralResponse {
    return {
      ...this.response,
      choices: [
        {
          ...this.response.choices[0],
          message: {
            role: "assistant",
            content: contentMessage,
            tool_calls: undefined,
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

class MistralStreamAdapter
  implements LLMStreamAdapter<MistralStreamChunk, MistralResponse>
{
  readonly provider = "mistral" as const;
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

  processChunk(chunk: MistralStreamChunk): ChunkProcessingResult {
    if (this.state.timing.firstChunkTime === null) {
      this.state.timing.firstChunkTime = Date.now();
    }

    let sseData: string | null = null;
    let isToolCallChunk = false;
    let isFinal = false;

    this.state.responseId = chunk.id;
    this.state.model = chunk.model;

    if (chunk.usage) {
      this.state.usage = {
        inputTokens: chunk.usage.prompt_tokens ?? 0,
        outputTokens: chunk.usage.completion_tokens ?? 0,
      };
    }

    const choice = chunk.choices[0];
    if (!choice) {
      return {
        sseData: null,
        isToolCallChunk: false,
        isFinal: this.state.usage !== null,
      };
    }

    const delta = choice.delta;

    if (delta.content) {
      this.state.text += delta.content;
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
    }

    if (this.state.usage !== null) {
      isFinal = true;
    }

    // Mistral might not send usage in a separate chunk, or might send it with the last choice
    if (choice.finish_reason && !chunk.usage) {
      // Should we wait for usage?
    }

    return { sseData, isToolCallChunk, isFinal };
  }

  getSSEHeaders(): Record<string, string> {
    return {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    };
  }

  formatTextDeltaSSE(text: string): string {
    const chunk: MistralStreamChunk = {
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
    const chunk: MistralStreamChunk = {
      id: this.state.responseId || `mistral-${Date.now()}`,
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
    const finalChunk: MistralStreamChunk = {
      id: this.state.responseId,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: this.state.model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason:
            (this.state.stopReason as Mistral.Types.FinishReason) ?? "stop",
        },
      ],
    };
    return `data: ${JSON.stringify(finalChunk)}\n\ndata: [DONE]\n\n`;
  }

  toProviderResponse(): MistralResponse {
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
            (this.state.stopReason as Mistral.Types.FinishReason) ?? "stop",
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
// TOON COMPRESSION
// =============================================================================

async function convertToolResultsToToon(
  messages: MistralMessages,
  model: string,
): Promise<{
  messages: MistralMessages;
  stats: CompressionStats;
}> {
  const tokenizer = getTokenizer("mistral");
  let toolResultCount = 0;
  let totalTokensBefore = 0;
  let totalTokensAfter = 0;

  const result = messages.map((message) => {
    if (message.role === "tool") {
      if (typeof message.content === "string") {
        try {
          const unwrapped = unwrapToolContent(message.content);
          const parsed = JSON.parse(unwrapped);
          const noncompressed = unwrapped;
          const compressed = toonEncode(parsed);

          const tokensBefore = tokenizer.countTokens([
            { role: "user", content: noncompressed },
          ]);
          const tokensAfter = tokenizer.countTokens([
            { role: "user", content: compressed },
          ]);

          totalTokensBefore += tokensBefore;
          totalTokensAfter += tokensAfter;
          toolResultCount++;

          return {
            ...message,
            content: compressed,
          };
        } catch {
          return message;
        }
      }
    }

    return message;
  });

  let toonCostSavings: number | null = null;
  if (toolResultCount > 0) {
    const tokensSaved = totalTokensBefore - totalTokensAfter;
    if (tokensSaved > 0) {
      const tokenPrice = await TokenPriceModel.findByModel(model);
      if (tokenPrice) {
        const inputPricePerToken =
          Number(tokenPrice.pricePerMillionInput) / 1000000;
        toonCostSavings = tokensSaved * inputPricePerToken;
      }
    }
  }

  return {
    messages: result,
    stats: {
      toonTokensBefore: toolResultCount > 0 ? totalTokensBefore : null,
      toonTokensAfter: toolResultCount > 0 ? totalTokensAfter : null,
      toonCostSavings,
    },
  };
}

// =============================================================================
// ADAPTER FACTORY
// =============================================================================

export const mistralAdapterFactory: LLMProvider<
  MistralRequest,
  MistralResponse,
  MistralMessages,
  MistralStreamChunk,
  MistralHeaders
> = {
  provider: "mistral",
  interactionType: "mistral:chatCompletions",

  createRequestAdapter(
    request: MistralRequest,
  ): LLMRequestAdapter<MistralRequest, MistralMessages> {
    return new MistralRequestAdapter(request);
  },

  createResponseAdapter(
    response: MistralResponse,
  ): LLMResponseAdapter<MistralResponse> {
    return new MistralResponseAdapter(response);
  },

  createStreamAdapter(): LLMStreamAdapter<MistralStreamChunk, MistralResponse> {
    return new MistralStreamAdapter();
  },

  extractApiKey(headers: MistralHeaders): string | undefined {
    return headers.authorization;
  },

  getBaseUrl(): string | undefined {
    return config.llm.mistral.baseUrl;
  },

  getSpanName(): string {
    return "mistral.chat.completions";
  },

  createClient(
    apiKey: string | undefined,
    options?: CreateClientOptions,
  ): OpenAIProvider {
    // Use observable fetch for request duration metrics if agent is provided
    const customFetch = options?.agent
      ? getObservableFetch("mistral", options.agent, options.externalAgentId)
      : undefined;

    return new OpenAIProvider({
      apiKey: apiKey ?? config.llm.mistral.apiKey,
      baseURL: options?.baseUrl || config.llm.mistral.baseUrl,
      fetch: customFetch,
    });
  },

  async execute(
    client: unknown,
    request: MistralRequest,
  ): Promise<MistralResponse> {
    const mistralClient = client as OpenAIProvider;
    return mistralClient.chat.completions.create({
      ...(request as unknown as OpenAIProvider.Chat.ChatCompletionCreateParams),
      stream: false,
    }) as Promise<MistralResponse>;
  },

  async executeStream(
    client: unknown,
    request: MistralRequest,
  ): Promise<AsyncIterable<MistralStreamChunk>> {
    const mistralClient = client as OpenAIProvider;
    const stream = (await mistralClient.chat.completions.create({
      ...(request as unknown as OpenAIProvider.Chat.ChatCompletionCreateParams),
      stream: true,
      stream_options: {
        include_usage: true,
      } as unknown as { include_usage: boolean },
    })) as unknown as AsyncIterable<MistralStreamChunk>;

    return {
      [Symbol.asyncIterator]: async function* () {
        for await (const chunk of stream) {
          yield chunk as MistralStreamChunk;
        }
      },
    };
  },

  extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return "Internal server error";
  },
};
