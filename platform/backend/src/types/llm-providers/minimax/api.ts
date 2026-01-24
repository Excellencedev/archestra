/**
 * MiniMax API Types
 *
 * MiniMax exposes an OpenAI-compatible API server.
 * See: https://platform.minimax.io/docs/api-reference/text-openai-api
 */
import { z } from "zod";

import { MessageParamSchema } from "./messages";
import { ToolChoiceOptionSchema, ToolSchema } from "./tools";

export const ChatCompletionUsageSchema = z
    .object({
        completion_tokens: z.number(),
        prompt_tokens: z.number(),
        total_tokens: z.number(),
        completion_tokens_details: z.unknown().optional(),
        prompt_tokens_details: z.unknown().optional(),
    })
    .describe("Token usage statistics for the completion");

export const FinishReasonSchema = z.enum([
    "stop",
    "length",
    "tool_calls",
    "content_filter",
    "function_call",
]);

const ChoiceSchema = z
    .object({
        finish_reason: FinishReasonSchema,
        index: z.number(),
        logprobs: z.unknown().nullable(),
        message: z
            .object({
                content: z.string().nullable(),
                role: z.enum(["assistant"]),
                function_call: z
                    .object({
                        arguments: z.string(),
                        name: z.string(),
                    })
                    .nullable()
                    .optional(),
                tool_calls: z
                    .array(
                        z.object({
                            id: z.string(),
                            type: z.enum(["function"]),
                            function: z.object({
                                arguments: z.string(),
                                name: z.string(),
                            }),
                        }),
                    )
                    .optional(),
            })
            .describe("The assistant message in the response"),
    })
    .describe("A choice in the chat completion response");

export const ChatCompletionRequestSchema = z
    .object({
        model: z.string(),
        messages: z.array(MessageParamSchema),
        tools: z.array(ToolSchema).optional(),
        tool_choice: ToolChoiceOptionSchema.optional(),
        temperature: z.number().nullable().optional(),
        max_tokens: z.number().nullable().optional(),
        stream: z.boolean().nullable().optional(),
        top_p: z.number().nullable().optional(),
        stop: z.union([z.string(), z.array(z.string())]).optional(),
    })
    .describe("MiniMax chat completion request (OpenAI-compatible)");

export const ChatCompletionResponseSchema = z
    .object({
        id: z.string(),
        choices: z.array(ChoiceSchema),
        created: z.number(),
        model: z.string(),
        object: z.enum(["chat.completion"]),
        usage: ChatCompletionUsageSchema.optional(),
    })
    .describe("MiniMax chat completion response (OpenAI-compatible)");

export const ChatCompletionsHeadersSchema = z.object({
    "user-agent": z.string().optional().describe("The user agent of the client"),
    authorization: z
        .string()
        .describe("Bearer token for MiniMax")
        .transform((authorization) => authorization.replace("Bearer ", "")),
});
