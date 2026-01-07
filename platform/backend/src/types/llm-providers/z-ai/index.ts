import type OpenAIProvider from "openai";
import type { z } from "zod";
import * as ZAiAPI from "./api";
import * as ZAiMessages from "./messages";
import * as ZAiTools from "./tools";

namespace ZAi {
  export const API = ZAiAPI;
  export const Messages = ZAiMessages;
  export const Tools = ZAiTools;

  export namespace Types {
    export type ChatCompletionsHeaders = z.infer<
      typeof ZAiAPI.ChatCompletionsHeadersSchema
    >;
    export type ChatCompletionsRequest = z.infer<
      typeof ZAiAPI.ChatCompletionRequestSchema
    >;
    export type ChatCompletionsResponse = z.infer<
      typeof ZAiAPI.ChatCompletionResponseSchema
    >;
    export type Usage = z.infer<typeof ZAiAPI.ChatCompletionUsageSchema>;

    export type FinishReason = z.infer<typeof ZAiAPI.FinishReasonSchema>;
    export type Message = z.infer<typeof ZAiMessages.MessageParamSchema>;
    export type Role = Message["role"];

    export type ChatCompletionChunk =
      OpenAIProvider.Chat.Completions.ChatCompletionChunk;
  }
}

export default ZAi;
