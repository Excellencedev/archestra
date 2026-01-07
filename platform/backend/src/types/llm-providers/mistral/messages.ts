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
      .describe(`https://docs.mistral.ai/api/#operation/createChatCompletion`),
  })
  .describe(`https://docs.mistral.ai/api/#operation/createChatCompletion`);

export const ToolCallSchema = z
  .union([FunctionToolCallSchema])
  .describe(`https://docs.mistral.ai/api/#operation/createChatCompletion`);

const ContentPartTextSchema = z
  .object({
    type: z.enum(["text"]),
    text: z.string(),
  })
  .describe(`https://docs.mistral.ai/api/#operation/createChatCompletion`);

const ContentPartImageSchema = z
  .object({
    type: z.enum(["image_url"]),
    image_url: z
      .object({
        url: z.string(),
        detail: z.enum(["auto", "low", "high"]),
      })
      .describe(`https://docs.mistral.ai/api/#operation/createChatCompletion`),
  })
  .describe(`https://docs.mistral.ai/api/#operation/createChatCompletion`);

const ContentPartSchema = z
  .union([ContentPartTextSchema, ContentPartImageSchema])
  .describe(`https://docs.mistral.ai/api/#operation/createChatCompletion`);

const SystemMessageParamSchema = z
  .object({
    content: z.union([z.string(), z.array(ContentPartTextSchema)]),
    role: z.enum(["system"]),
    name: z.string().optional(),
  })
  .describe(`https://docs.mistral.ai/api/#operation/createChatCompletion`);

const UserMessageParamSchema = z
  .object({
    content: z.union([z.string(), z.array(ContentPartSchema)]),
    role: z.enum(["user"]),
    name: z.string().optional(),
  })
  .describe(`https://docs.mistral.ai/api/#operation/createChatCompletion`);

const AssistantMessageParamSchema = z
  .object({
    role: z.enum(["assistant"]),
    content: z
      .union([z.string(), z.array(ContentPartTextSchema)])
      .nullable()
      .optional(),
    name: z.string().optional(),
    tool_calls: z.array(ToolCallSchema).optional(),
  })
  .describe(`https://docs.mistral.ai/api/#operation/createChatCompletion`);

const ToolMessageParamSchema = z
  .object({
    role: z.enum(["tool"]),
    content: z.union([z.string(), z.array(ContentPartTextSchema)]),
    tool_call_id: z.string(),
    name: z.string().optional(),
  })
  .describe(`https://docs.mistral.ai/api/#operation/createChatCompletion`);

export const MessageParamSchema = z
  .union([
    SystemMessageParamSchema,
    UserMessageParamSchema,
    AssistantMessageParamSchema,
    ToolMessageParamSchema,
  ])
  .describe(`https://docs.mistral.ai/api/#operation/createChatCompletion`);
