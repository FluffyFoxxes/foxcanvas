import { describe, expect, it } from "vitest";
import {
  MAX_CANVAS_DOCUMENT_BYTES,
  canvasDocumentSchema,
} from "@foxcanvas/canvas-schema";
import {
  MAX_CANVAS_IMPORT_BYTES,
  boardFitViewOptions,
  createAiGraph,
  createHistory,
  duplicateNodes,
  guardCanvasDocumentChange,
  historyPush,
  parseImportFile,
  redo,
  safeParseDocument,
  undo,
} from "./board";

function stickyDocument(count: number, textLength = 10_000) {
  return {
    nodes: Array.from({ length: count }, (_, index) => ({
      id: `sticky-${index}`,
      type: "sticky",
      position: { x: index, y: index },
      data: { text: "x".repeat(textLength), color: "yellow" },
    })),
    edges: [],
  };
}

describe("board state", () => {
  const empty = { nodes: [], edges: [] };
  it("connects each generated idea to its title in a valid document", () => {
    let id = 0;
    const graph = createAiGraph(
      {
        title: "Plan",
        items: [{ text: "First", color: "mint" }, { text: "Second" }],
      },
      { x: 10, y: 20 },
      () => `id-${++id}`,
    );
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges.map(({ source, target }) => [source, target])).toEqual([
      [graph.nodes[0].id, graph.nodes[1].id],
      [graph.nodes[0].id, graph.nodes[2].id],
    ]);
    expect(canvasDocumentSchema.safeParse(graph).success).toBe(true);
    expect(
      createAiGraph({ title: "Empty", items: [] }, { x: 0, y: 0 }),
    ).toEqual({ nodes: [], edges: [] });
  });

  it("supports undo and redo without mutating snapshots", () => {
    const h = historyPush(createHistory(empty), {
      nodes: [
        {
          id: "1",
          type: "sticky",
          position: { x: 0, y: 0 },
          data: { text: "A", color: "yellow" },
        },
      ],
      edges: [],
    });
    const undone = undo(h);
    expect(undone.present).toEqual(empty);
    expect(redo(undone).present.nodes).toHaveLength(1);
  });

  it("duplicates selected nodes with fresh ids and shifted positions", () => {
    const nodes = [
      {
        id: "1",
        type: "sticky",
        selected: true,
        position: { x: 1, y: 2 },
        data: { text: "A", color: "yellow" },
      },
    ];
    const copy = duplicateNodes(nodes, () => "fresh");
    expect(copy).toHaveLength(2);
    expect(copy[1]).toMatchObject({
      id: "fresh",
      selected: true,
      position: { x: 25, y: 26 },
    });
    expect(copy[0].selected).toBe(false);
  });

  it("does not enlarge a sparse board beyond 100% on initial fit", () => {
    expect(boardFitViewOptions.maxZoom).toBe(1);
  });

  it("validates imported documents and rejects malformed data", () => {
    expect(safeParseDocument(JSON.stringify(empty))).toEqual(empty);
    expect(() => safeParseDocument('{"nodes":"oops"}')).toThrow(
      /valid FoxCanvas/i,
    );
  });

  it("rejects duplicate node and edge IDs", () => {
    const node = {
      id: "same",
      type: "sticky",
      position: { x: 0, y: 0 },
      data: { text: "A", color: "yellow" },
    };
    expect(() =>
      safeParseDocument(JSON.stringify({ nodes: [node, node], edges: [] })),
    ).toThrow(/valid FoxCanvas/i);
    const other = { ...node, id: "other" };
    const edge = { id: "edge", source: "same", target: "other" };
    expect(() =>
      safeParseDocument(
        JSON.stringify({ nodes: [node, other], edges: [edge, edge] }),
      ),
    ).toThrow(/valid FoxCanvas/i);
  });

  it("rejects dangling edges", () => {
    const node = {
      id: "one",
      type: "text",
      position: { x: 0, y: 0 },
      data: { text: "A", color: "gray" },
    };
    expect(() =>
      safeParseDocument(
        JSON.stringify({
          nodes: [node],
          edges: [{ id: "edge", source: "one", target: "missing" }],
        }),
      ),
    ).toThrow(/valid FoxCanvas/i);
  });

  it("rejects unsupported node types and unknown persisted fields", () => {
    expect(() =>
      safeParseDocument(
        JSON.stringify({
          nodes: [
            {
              id: "one",
              type: "image",
              position: { x: 0, y: 0 },
              data: { url: "https://example.com" },
            },
          ],
          edges: [],
        }),
      ),
    ).toThrow(/valid FoxCanvas/i);
    expect(() =>
      safeParseDocument(
        JSON.stringify({
          nodes: [
            {
              id: "one",
              type: "sticky",
              position: { x: 0, y: 0 },
              data: { text: "A", color: "yellow", unexpected: true },
            },
          ],
          edges: [],
        }),
      ),
    ).toThrow(/valid FoxCanvas/i);
  });

  it("rejects non-finite positions", () => {
    expect(() =>
      safeParseDocument(
        '{"nodes":[{"id":"one","type":"shape","position":{"x":1e400,"y":0},"data":{"label":"A","color":"blue","shape":"rectangle"}}],"edges":[]}',
      ),
    ).toThrow(/valid FoxCanvas/i);
  });

  it("caps imports before reading the file body", async () => {
    let read = false;
    const file = {
      size: MAX_CANVAS_IMPORT_BYTES + 1,
      text: async () => {
        read = true;
        return JSON.stringify(empty);
      },
    };
    await expect(parseImportFile(file)).rejects.toThrow(/too large/i);
    expect(read).toBe(false);
  });

  it("accepts eleven maximum-length stickies within the aggregate document limit", () => {
    const document = stickyDocument(11);
    expect(
      new TextEncoder().encode(JSON.stringify(document)).byteLength,
    ).toBeLessThan(MAX_CANVAS_DOCUMENT_BYTES);
    expect(canvasDocumentSchema.safeParse(document).success).toBe(true);
  });

  it("rejects a document above the aggregate serialized UTF-8 byte limit", () => {
    const document = stickyDocument(51);
    expect(
      new TextEncoder().encode(JSON.stringify(document)).byteLength,
    ).toBeGreaterThan(MAX_CANVAS_DOCUMENT_BYTES);
    const result = canvasDocumentSchema.safeParse(document);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringMatching(/serialized UTF-8 bytes/i),
          }),
        ]),
      );
  });

  it("measures the aggregate limit in UTF-8 bytes rather than JavaScript string length", () => {
    const document = stickyDocument(25, 0);
    for (const node of document.nodes)
      node.data.text = "\ud83d\ude00".repeat(5_000);
    const serialized = JSON.stringify(document);
    expect(serialized.length).toBeLessThan(MAX_CANVAS_DOCUMENT_BYTES);
    expect(new TextEncoder().encode(serialized).byteLength).toBeGreaterThan(
      MAX_CANVAS_DOCUMENT_BYTES,
    );
    expect(canvasDocumentSchema.safeParse(document).success).toBe(false);
  });

  it("retains the previous document and returns a useful error for a rejected editor change", () => {
    const previous = { nodes: [], edges: [] };
    const rejected = guardCanvasDocumentChange(previous, stickyDocument(51));

    expect(rejected.accepted).toBe(false);
    expect(rejected.document).toBe(previous);
    expect(rejected.error).toMatch(/too large/i);
  });

  it("accepts a valid editor change without replacing its document reference", () => {
    const previous = { nodes: [], edges: [] };
    const candidate = stickyDocument(11);
    const accepted = guardCanvasDocumentChange(previous, candidate);

    expect(accepted).toEqual({
      accepted: true,
      document: candidate,
      error: null,
    });
    expect(accepted.document).toBe(candidate);
  });
});
