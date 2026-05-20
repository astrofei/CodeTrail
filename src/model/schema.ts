import { z } from 'zod';

const pointSchema = z.object({
  x: z.number(),
  y: z.number()
});

const sizeSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive()
});

const callAnchorSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  line: z.number().int().positive(),
  startColumn: z.number().int().nonnegative(),
  endColumn: z.number().int().nonnegative()
});

const codeNodeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  language: z.string().min(1),
  summary: z.string(),
  codeSnapshot: z.string(),
  position: pointSchema,
  size: sizeSchema,
  collapsed: z.boolean(),
  color: z.string().min(1),
  scopeId: z.string().min(1).nullable(),
  callAnchors: z.array(callAnchorSchema)
});

const edgeSchema = z.object({
  id: z.string().min(1),
  sourceNodeId: z.string().min(1),
  sourceAnchorId: z.string().min(1),
  targetNodeId: z.string().min(1),
  label: z.string(),
  color: z.string().min(1)
});

const scopeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  color: z.string().min(1),
  bounds: pointSchema.merge(sizeSchema)
});

export const codeTrailDocumentSchema = z.object({
  version: z.literal(1),
  metadata: z.object({
    title: z.string().min(1),
    description: z.string(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1)
  }),
  nodes: z.array(codeNodeSchema),
  edges: z.array(edgeSchema),
  scopes: z.array(scopeSchema),
  viewport: z.object({
    x: z.number(),
    y: z.number(),
    zoom: z.number().positive()
  })
});
