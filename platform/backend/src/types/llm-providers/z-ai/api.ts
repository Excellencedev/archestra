import { z } from "zod";

import { MessageParamSchema, ToolCallSchema } from "./messages";
import { ToolChoiceOptionSchema, ToolSchema } from "./tools";

export const ChatCompletionUsageSchema = z.object({
  completion_tokens: z.number(),
  prompt_tokens: z.number(),
  total_tokens: z.number(),
});

export const FinishReasonSchema = z.enum([
  "stop",
  "length",
  "tool_calls",
  "content_filter",
]);

const ChoiceSchema = z.object({
  finish_reason: FinishReasonSchema.nullable(),
  index: z.number(),
  message: z.object({
    content: z.string().nullable(),
    role: z.enum(["assistant"]),
    tool_calls: z.array(ToolCallSchema).optional(),
  }),
});

export const ChatCompletionRequestSchema = z.object({
  model: z.string(),
  messages: z.array(MessageParamSchema),
  tools: z.array(ToolSchema).optional(),
  tool_choice: ToolChoiceOptionSchema.optional(),
  temperature: z.number().nullable().optional(),
  top_p: z.number().nullable().optional(),
  max_tokens: z.number().nullable().optional(),
  stream: z.boolean().nullable().optional(),
  stop: z
    .union([z.string(), z.array(z.string())])
    .nullable()
    .optional(),
});

export const ChatCompletionResponseSchema = z.object({
  id: z.string(),
  object: z.literal("chat.completion"),
  choices: z.array(ChoiceSchema),
  created: z.number(),
  model: z.string(),
  usage: ChatCompletionUsageSchema.optional(),
});

export const ChatCompletionsHeadersSchema = z.object({
  authorization: z
    .string()
    .transform((authorization) => authorization.replace("Bearer ", "")),
});
