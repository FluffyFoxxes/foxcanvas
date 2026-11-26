import { z } from "zod";

export const MAX_CANVAS_NODES = 2_000;
export const MAX_CANVAS_EDGES = 4_000;
export const MAX_CANVAS_IMPORT_BYTES = 100_000;
export const MAX_CANVAS_DOCUMENT_BYTES = 500_000;
export const MAX_CANVAS_TEXT_LENGTH = 10_000;
export const MAX_CANVAS_LABEL_LENGTH = 1_000;

const idSchema = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (value) => value === value.trim(),
    "IDs must not have surrounding whitespace",
  );
const finiteNumber = z.number().finite();
const dimension = finiteNumber.nonnegative().max(100_000);
const color = z.enum(["yellow", "coral", "mint", "blue", "purple", "gray"]);
const position = z.object({ x: finiteNumber, y: finiteNumber }).strict();
const measured = z
  .object({ width: dimension.optional(), height: dimension.optional() })
  .strict();
const extent = z.union([
  z.literal("parent"),
  z.tuple([
    z.tuple([finiteNumber, finiteNumber]),
    z.tuple([finiteNumber, finiteNumber]),
  ]),
]);

const commonNode = {
  id: idSchema,
  position,
  selected: z.boolean().optional(),
  dragging: z.boolean().optional(),
  draggable: z.boolean().optional(),
  selectable: z.boolean().optional(),
  connectable: z.boolean().optional(),
  deletable: z.boolean().optional(),
  focusable: z.boolean().optional(),
  hidden: z.boolean().optional(),
  width: dimension.optional(),
  height: dimension.optional(),
  initialWidth: dimension.optional(),
  initialHeight: dimension.optional(),
  measured: measured.optional(),
  positionAbsolute: position.optional(),
  parentId: idSchema.optional(),
  extent: extent.optional(),
  expandParent: z.boolean().optional(),
  origin: z.tuple([finiteNumber, finiteNumber]).optional(),
  zIndex: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  ariaLabel: z.string().max(500).optional(),
  className: z.string().max(500).optional(),
};

const stickyNode = z
  .object({
    ...commonNode,
    type: z.literal("sticky"),
    data: z
      .object({ text: z.string().max(MAX_CANVAS_TEXT_LENGTH), color })
      .strict(),
  })
  .strict();
const textNode = z
  .object({
    ...commonNode,
    type: z.literal("text"),
    data: z
      .object({ text: z.string().max(MAX_CANVAS_TEXT_LENGTH), color })
      .strict(),
  })
  .strict();
const shapeNode = z
  .object({
    ...commonNode,
    type: z.literal("shape"),
    data: z
      .object({
        label: z.string().max(MAX_CANVAS_LABEL_LENGTH),
        color,
        shape: z.enum(["rectangle", "ellipse", "diamond"]),
      })
      .strict(),
  })
  .strict();

const marker = z
  .object({
    type: z.enum(["arrow", "arrowclosed"]),
    color: z.string().max(128).optional(),
    width: dimension.optional(),
    height: dimension.optional(),
    markerUnits: z.enum(["strokeWidth", "userSpaceOnUse"]).optional(),
    orient: z.union([finiteNumber, z.string().max(64)]).optional(),
    strokeWidth: finiteNumber.nonnegative().max(50).optional(),
  })
  .strict();
const edgeStyle = z
  .object({
    stroke: z.string().max(128).optional(),
    strokeWidth: finiteNumber.nonnegative().max(50).optional(),
    strokeDasharray: z.union([z.string().max(128), finiteNumber]).optional(),
    fill: z.string().max(128).optional(),
    opacity: finiteNumber.min(0).max(1).optional(),
  })
  .strict();
const edge = z
  .object({
    id: idSchema,
    source: idSchema,
    target: idSchema,
    sourceHandle: z.string().max(128).nullable().optional(),
    targetHandle: z.string().max(128).nullable().optional(),
    type: z
      .enum(["default", "straight", "step", "smoothstep", "simplebezier"])
      .optional(),
    animated: z.boolean().optional(),
    hidden: z.boolean().optional(),
    selected: z.boolean().optional(),
    deletable: z.boolean().optional(),
    selectable: z.boolean().optional(),
    focusable: z.boolean().optional(),
    reconnectable: z.boolean().optional(),
    markerStart: z.union([marker, z.string().max(256)]).optional(),
    markerEnd: z.union([marker, z.string().max(256)]).optional(),
    style: edgeStyle.optional(),
    label: z.union([z.string().max(1_000), finiteNumber]).optional(),
    interactionWidth: dimension.optional(),
    zIndex: z.number().int().min(-1_000_000).max(1_000_000).optional(),
    ariaLabel: z.string().max(500).optional(),
    className: z.string().max(500).optional(),
  })
  .strict();

export const canvasDocumentSchema = z
  .object({
    nodes: z
      .array(z.discriminatedUnion("type", [stickyNode, textNode, shapeNode]))
      .max(MAX_CANVAS_NODES),
    edges: z.array(edge).max(MAX_CANVAS_EDGES),
  })
  .strict()
  .superRefine((document, context) => {
    const serializedBytes = new TextEncoder().encode(
      JSON.stringify(document),
    ).byteLength;
    if (serializedBytes > MAX_CANVAS_DOCUMENT_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Canvas document must not exceed ${MAX_CANVAS_DOCUMENT_BYTES} serialized UTF-8 bytes`,
      });
    }
    const nodeIds = new Set();
    for (const [index, node] of document.nodes.entries()) {
      if (nodeIds.has(node.id))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nodes", index, "id"],
          message: "Node IDs must be unique",
        });
      nodeIds.add(node.id);
    }
    const edgeIds = new Set();
    for (const [index, currentEdge] of document.edges.entries()) {
      if (edgeIds.has(currentEdge.id))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", index, "id"],
          message: "Edge IDs must be unique",
        });
      edgeIds.add(currentEdge.id);
      if (!nodeIds.has(currentEdge.source))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", index, "source"],
          message: "Edge source must reference a node",
        });
      if (!nodeIds.has(currentEdge.target))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", index, "target"],
          message: "Edge target must reference a node",
        });
    }
  });
