import { z } from "zod";

export const FunctionDefinitionParametersSchema = z
  .record(z.string(), z.unknown())
  .optional();

const FunctionDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  parameters: FunctionDefinitionParametersSchema,
});

const FunctionToolSchema = z.object({
  type: z.enum(["function"]),
  function: FunctionDefinitionSchema,
});

const CustomToolSchema = z.object({
  type: z.enum(["custom"]),
  custom: z.object({
    name: z.string(),
    description: z.string().optional(),
  }),
});

const NamedToolChoiceSchema = z.object({
  type: z.enum(["function"]),
  function: z.object({
    name: z.string(),
  }),
});

export const ToolSchema = z.union([FunctionToolSchema, CustomToolSchema]);

export const ToolChoiceOptionSchema = z.union([
  z.enum(["none", "auto", "required"]),
  NamedToolChoiceSchema,
  CustomToolSchema,
]);
