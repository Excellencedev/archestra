import { z } from "zod";

export const FunctionDefinitionParametersSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .describe(`
    https://docs.mistral.ai/api/#operation/createChatCompletion
  `);

const FunctionDefinitionSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    parameters: FunctionDefinitionParametersSchema,
    strict: z.boolean().nullable().optional(),
  })
  .describe(`https://docs.mistral.ai/api/#operation/createChatCompletion`);

const FunctionToolSchema = z
  .object({
    type: z.enum(["function"]),
    function: FunctionDefinitionSchema,
  })
  .describe(`https://docs.mistral.ai/api/#operation/createChatCompletion`);

export const ToolSchema = z.union([FunctionToolSchema]).describe(`
  A function tool that can be used to generate a response.
  https://docs.mistral.ai/api/#operation/createChatCompletion
  `);

export const ToolChoiceOptionSchema = z
  .union([
    z.enum(["none", "auto", "any", "required"]),
    z.object({
      type: z.enum(["function"]),
      function: z.object({
        name: z.string(),
      }),
    }),
  ])
  .describe(`https://docs.mistral.ai/api/#operation/createChatCompletion`);
