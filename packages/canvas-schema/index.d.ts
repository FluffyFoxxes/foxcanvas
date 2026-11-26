import type { z } from "zod";

export type CanvasColor =
  "yellow" | "coral" | "mint" | "blue" | "purple" | "gray";
export type CanvasShape = "rectangle" | "ellipse" | "diamond";
export type PersistedCanvasDocument = {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
};

export const MAX_CANVAS_NODES: 2000;
export const MAX_CANVAS_EDGES: 4000;
export const MAX_CANVAS_IMPORT_BYTES: 100000;
export const MAX_CANVAS_DOCUMENT_BYTES: 500000;
export const MAX_CANVAS_TEXT_LENGTH: 10000;
export const MAX_CANVAS_LABEL_LENGTH: 1000;
export const canvasDocumentSchema: z.ZodType<PersistedCanvasDocument>;
