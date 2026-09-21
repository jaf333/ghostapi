import { z } from 'zod';

/**
 * A deliberately small JSON Schema subset. GhostAPI only ever emits what it can
 * justify from evidence, so supporting the full spec would be dead weight — and
 * a smaller surface is a smaller attack surface when a schema arrives from a
 * page we do not trust.
 */
export type JsonSchemaType =
  'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';

export interface JsonSchema {
  type?: JsonSchemaType | JsonSchemaType[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: (string | number | boolean | null)[];
  format?: string;
  nullable?: boolean;
  examples?: unknown[];
  additionalProperties?: boolean;
}

export const jsonSchemaTypeSchema = z.enum([
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
  'null',
]);

export const jsonSchemaSchema: z.ZodType<JsonSchema> = z.lazy(() =>
  z
    .object({
      type: z.union([jsonSchemaTypeSchema, z.array(jsonSchemaTypeSchema)]).optional(),
      description: z.string().optional(),
      properties: z.record(jsonSchemaSchema).optional(),
      required: z.array(z.string()).optional(),
      items: jsonSchemaSchema.optional(),
      enum: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
      format: z.string().optional(),
      nullable: z.boolean().optional(),
      examples: z.array(z.unknown()).optional(),
      additionalProperties: z.boolean().optional(),
    })
    .strict(),
);
