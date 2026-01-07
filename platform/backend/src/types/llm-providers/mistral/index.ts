import type { z } from "zod";
import * as MistralAPI from "./api";
import * as MistralMessages from "./messages";
import * as MistralTools from "./tools";

namespace Mistral {
  export const API = MistralAPI;
  export const Messages = MistralMessages;
  export const Tools = MistralTools;

  export namespace Types {
    export type ChatCompletionsHeaders = z.infer<
      typeof MistralAPI.ChatCompletionsHeadersSchema
    >;
    export type ChatCompletionsRequest = z.infer<
      typeof MistralAPI.ChatCompletionRequestSchema
    >;
    export type ChatCompletionsResponse = z.infer<
      typeof MistralAPI.ChatCompletionResponseSchema
    >;
    export type Usage = z.infer<typeof MistralAPI.ChatCompletionUsageSchema>;

    export type FinishReason = z.infer<typeof MistralAPI.FinishReasonSchema>;
    export type Message = z.infer<typeof MistralMessages.MessageParamSchema>;
    export type Role = Message["role"];

    export type ChatCompletionChunk = {
      id: string;
      object: "chat.completion.chunk";
      created: number;
      model: string;
      choices: Array<{
        index: number;
        delta: {
          role?: "assistant";
          content?: string | null;
          tool_calls?: Array<{
            index: number;
            id?: string;
            type?: "function";
            function?: {
              name?: string;
              arguments?: string;
            };
          }>;
        };
        finish_reason: FinishReason | null;
      }>;
      usage?: Usage;
    };
  }
}

export default Mistral;
