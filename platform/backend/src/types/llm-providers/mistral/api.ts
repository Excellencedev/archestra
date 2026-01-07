import { z } from "zod";

import { MessageParamSchema, ToolCallSchema } from "./messages";
import { ToolChoiceOptionSchema, ToolSchema } from "./tools";

export const ChatCompletionUsageSchema = z
  .object({
    completion_tokens: z.number(),
    prompt_tokens: z.number(),
    total_tokens: z.number(),
  })
  .describe(`https://docs.mistral.ai/api/#operation/createChatCompletion`);

export const FinishReasonSchema = z.enum([
  "stop",
  "length",
  "tool_calls",
  "content_filter",
  "model_exceeded",
]);

const ChoiceSchema = z
  .object({
    finish_reason: FinishReasonSchema,
    index: z.number(),
    message: z
      .object({
        content: z.string().nullable(),
        role: z.enum(["assistant"]),
        tool_calls: z.array(ToolCallSchema).optional(),
      })
      .describe(`https://docs.mistral.ai/api/#operation/createChatCompletion`),
  })
  .describe(`https://docs.mistral.ai/api/#operation/createChatCompletion`);

export const ChatCompletionRequestSchema = z
  .object({
    model: z.string(),
    messages: z.array(MessageParamSchema),
    tools: z.array(ToolSchema).optional(),
    tool_choice: ToolChoiceOptionSchema.optional(),
    temperature: z.number().nullable().optional(),
    max_tokens: z.number().nullable().optional(),
    stream: z.boolean().nullable().optional(),
    safe_prompt: z.boolean().optional(),
    random_seed: z.number().optional(),
  })
  .describe(`https://docs.mistral.ai/api/#operation/createChatCompletion`);

export const ChatCompletionResponseSchema = z
  .object({
    id: z.string(),
    choices: z.array(ChoiceSchema),
    created: z.number(),
    model: z.string(),
    object: z.enum(["chat.completion"]),
    usage: ChatCompletionUsageSchema.optional(),
  })
  .describe(`https://docs.mistral.ai/api/#operation/createChatCompletion`);

export const ChatCompletionsHeadersSchema = z.object({
  "user-agent": z.string().optional().describe("The user agent of the client"),
  authorization: z
    .string()
    .optional()
    .describe("Bearer token for Mistral AI")
    .transform((authorization) => authorization?.replace("Bearer ", "")),
});
