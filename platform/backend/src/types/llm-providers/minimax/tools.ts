/**
 * MiniMax Tool Types
 *
 * MiniMax uses OpenAI-compatible tool format.
 * See: https://platform.minimax.io/docs/api-reference/text-openai-api
 */
import { z } from "zod";

export const FunctionDefinitionSchema = z
    .object({
        name: z.string(),
        description: z.string().optional(),
        parameters: z.record(z.string(), z.unknown()).optional().describe(`
    The parameters the functions accepts, described as a JSON Schema object.
    Omitting parameters defines a function with an empty parameter list.
  `),
        strict: z.boolean().nullable().optional(),
    })
    .describe("A function definition for tool calling");

export const ToolSchema = z
    .object({
        type: z.enum(["function"]),
        function: FunctionDefinitionSchema,
    })
    .describe("A function tool definition");

export const ToolChoiceOptionSchema = z.union([
    z.enum(["none", "auto", "required"]),
    z.object({
        type: z.enum(["function"]),
        function: z.object({
            name: z.string(),
        }),
    }),
]);
