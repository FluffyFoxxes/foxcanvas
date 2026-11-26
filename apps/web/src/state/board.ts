import {
  MAX_CANVAS_IMPORT_BYTES,
  canvasDocumentSchema,
} from "@foxcanvas/canvas-schema";
import { MarkerType, type Edge, type Node } from "@xyflow/react";

export { MAX_CANVAS_IMPORT_BYTES } from "@foxcanvas/canvas-schema";

export type CanvasData = {
  text?: string;
  color?: string;
  label?: string;
  shape?: "rectangle" | "ellipse" | "diamond";
  [key: string]: unknown;
};
export type CanvasDocument = { nodes: Node<CanvasData>[]; edges: Edge[] };
export type History = {
  past: CanvasDocument[];
  present: CanvasDocument;
  future: CanvasDocument[];
};
export type GuardedCanvasDocument =
  | { accepted: true; document: CanvasDocument; error: null }
  | { accepted: false; document: CanvasDocument; error: string };
export const boardFitViewOptions = { maxZoom: 1 } as const;

const clone = <T>(value: T): T => structuredClone(value);
export const createHistory = (document: CanvasDocument): History => ({
  past: [],
  present: clone(document),
  future: [],
});
export const historyPush = (
  history: History,
  document: CanvasDocument,
): History => ({
  past: [...history.past.slice(-49), clone(history.present)],
  present: clone(document),
  future: [],
});
export const undo = (history: History): History =>
  history.past.length
    ? {
        past: history.past.slice(0, -1),
        present: clone(history.past.at(-1)!),
        future: [clone(history.present), ...history.future],
      }
    : history;
export const redo = (history: History): History =>
  history.future.length
    ? {
        past: [...history.past, clone(history.present)],
        present: clone(history.future[0]),
        future: history.future.slice(1),
      }
    : history;

export function guardCanvasDocumentChange(
  previous: CanvasDocument,
  candidate: CanvasDocument,
): GuardedCanvasDocument {
  const validation = canvasDocumentSchema.safeParse(candidate);
  if (validation.success)
    return { accepted: true, document: candidate, error: null };
  const aggregateLimitExceeded = validation.error.issues.some(
    (issue) =>
      issue.code === "custom" && /serialized UTF-8 bytes/i.test(issue.message),
  );
  return {
    accepted: false,
    document: previous,
    error: aggregateLimitExceeded
      ? "This change would make the canvas too large. Remove some content and try again."
      : "This change would exceed the canvas limits. Remove some content and try again.",
  };
}

export function createAiGraph(
  result: { title: string; items: { text: string; color?: string }[] },
  origin: { x: number; y: number },
  createId: () => string = () => crypto.randomUUID(),
): CanvasDocument {
  if (!result.items.length) return { nodes: [], edges: [] };
  const columns = Math.min(3, result.items.length);
  const root: Node<CanvasData> = {
    id: createId(),
    type: "text",
    position: { x: origin.x + (columns - 1) * 120, y: origin.y },
    data: { text: result.title, color: "gray" },
  };
  const nodes: Node<CanvasData>[] = result.items.map((item, index) => ({
    id: createId(),
    type: "sticky",
    position: {
      x: origin.x + (index % columns) * 240,
      y: origin.y + 200 + Math.floor(index / columns) * 200,
    },
    data: { text: item.text, color: item.color ?? "yellow" },
  }));
  const edges: Edge[] = nodes.map((node) => ({
    id: createId(),
    source: root.id,
    target: node.id,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { strokeWidth: 2, stroke: "#77736c" },
  }));
  return { nodes: [root, ...nodes], edges };
}

export function duplicateNodes(
  nodes: Node<CanvasData>[],
  createId: () => string = () => crypto.randomUUID(),
) {
  const originals = nodes.map((node) => ({ ...node, selected: false }));
  const copies = nodes
    .filter((node) => node.selected)
    .map((node) => ({
      ...clone(node),
      id: createId(),
      position: { x: node.position.x + 24, y: node.position.y + 24 },
      selected: true,
    }));
  return [...originals, ...copies];
}

export function safeParseDocument(raw: string): CanvasDocument {
  try {
    if (new TextEncoder().encode(raw).byteLength > MAX_CANVAS_IMPORT_BYTES)
      throw new Error("Import too large");
    return canvasDocumentSchema.parse(JSON.parse(raw)) as CanvasDocument;
  } catch {
    throw new Error("This is not a valid FoxCanvas document.");
  }
}

export async function parseImportFile(
  file: Pick<File, "size" | "text">,
): Promise<CanvasDocument> {
  if (file.size > MAX_CANVAS_IMPORT_BYTES)
    throw new Error("This FoxCanvas import is too large.");
  return safeParseDocument(await file.text());
}
