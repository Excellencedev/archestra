/**
 * MiniMax Message Types
 *
 * MiniMax uses OpenAI-compatible message format.
 * See: https://platform.minimax.io/docs/api-reference/text-openai-api
 */
import { z } from "zod";

const FunctionToolCallSchema = z
    .object({
        id: z.string(),
        type: z.enum(["function"]),
        function: z
            .object({
                arguments: z.string(),
                name: z.string(),
            })
            .describe("Function call details"),
    })
    .describe("A function tool call in the message");

export const ToolCallSchema = FunctionToolCallSchema
    .describe("A tool call in the assistant message");

const ContentPartTextSchema = z
    .object({
        type: z.enum(["text"]),
        text: z.string(),
    })
    .describe("A text content part");

const ContentPartSchema = ContentPartTextSchema
    .describe("A content part in a message");

const DeveloperMessageParamSchema = z
    .object({
        content: z.union([z.string(), z.array(ContentPartTextSchema)]),
        role: z.enum(["developer"]),
        name: z.string().optional(),
    })
    .describe("A developer message");

const SystemMessageParamSchema = z
    .object({
        content: z.union([z.string(), z.array(ContentPartTextSchema)]),
        role: z.enum(["system"]),
        name: z.string().optional(),
    })
    .describe("A system message");

const UserMessageParamSchema = z
    .object({
        content: z.union([z.string(), z.array(ContentPartSchema)]),
        role: z.enum(["user"]),
        name: z.string().optional(),
    })
    .describe("A user message");

const AssistantMessageParamSchema = z
    .object({
        role: z.enum(["assistant"]),
        content: z
            .union([
                z.string(),
                z.array(ContentPartTextSchema),
            ])
            .nullable()
            .optional(),
        function_call: z
            .object({
                arguments: z.string(),
                name: z.string(),
            })
            .nullable()
            .optional(),
        name: z.string().optional(),
        tool_calls: z.array(ToolCallSchema).optional(),
    })
    .describe("An assistant message");

const ToolMessageParamSchema = z
    .object({
        role: z.enum(["tool"]),
        content: z.union([
            z.string(),
            z.array(ContentPartTextSchema),
        ]),
        tool_call_id: z.string(),
    })
    .describe("A tool result message");

const FunctionMessageParamSchema = z
    .object({
        role: z.enum(["function"]),
        content: z.string().nullable(),
        name: z.string(),
    })
    .describe("A function result message (deprecated)");

export const MessageParamSchema = z
    .union([
        DeveloperMessageParamSchema,
        SystemMessageParamSchema,
        UserMessageParamSchema,
        AssistantMessageParamSchema,
        ToolMessageParamSchema,
        FunctionMessageParamSchema,
    ])
    .describe("A message in the conversation");
