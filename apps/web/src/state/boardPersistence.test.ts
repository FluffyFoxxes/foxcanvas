import { describe, expect, it } from "vitest";
import {
  MAX_KEEPALIVE_BODY_BYTES,
  boardDraftStorageKey,
  createBoardSaveBody,
  findMatchingBoardDraft,
  normalizeBoardTitle,
  parseBoardDraft,
  serializeBoardDraft,
  validateKeepaliveBody,
} from "./boardPersistence";

describe("board draft persistence", () => {
  const document = {
    nodes: [
      {
        id: "n1",
        type: "sticky",
        position: { x: 1, y: 2 },
        data: { text: "Local idea", color: "yellow" },
      },
    ],
    edges: [],
  };
  const draft = {
    baseUpdatedAt: "2026-09-21T10:11:12.123Z",
    title: "Local title",
    document,
  };

  it("serializes and validates a strict durable draft", () => {
    const serialized = serializeBoardDraft(draft);
    expect(parseBoardDraft(serialized)).toEqual(draft);
    expect(JSON.parse(serialized)).toMatchObject({ version: 1, ...draft });
  });

  it("normalizes editor titles to the same non-empty trimmed form accepted by the API", () => {
    expect(normalizeBoardTitle("  Roadmap  ")).toBe("Roadmap");
    expect(normalizeBoardTitle("   ")).toBe("Untitled board");
  });

  it("restores only a draft whose optimistic base matches the loaded board", () => {
    const serialized = serializeBoardDraft(draft);
    expect(findMatchingBoardDraft(serialized, draft.baseUpdatedAt)).toEqual(
      draft,
    );
    expect(
      findMatchingBoardDraft(serialized, "2026-09-21T10:11:13.123Z"),
    ).toBeNull();
  });

  it("uses a separate storage key for each board", () => {
    expect(boardDraftStorageKey("board-a")).not.toBe(
      boardDraftStorageKey("board-b"),
    );
    expect(boardDraftStorageKey("board-a")).toContain("board-a");
  });

  it.each([
    ["invalid JSON", "{"],
    ["null", "null"],
    ["an array", "[]"],
    ["missing version", JSON.stringify(draft)],
    ["wrong version", JSON.stringify({ version: 2, ...draft })],
    ["unknown field", JSON.stringify({ version: 1, ...draft, secret: true })],
    [
      "invalid base",
      JSON.stringify({ version: 1, ...draft, baseUpdatedAt: "yesterday" }),
    ],
    [
      "oversized title",
      JSON.stringify({ version: 1, ...draft, title: "x".repeat(121) }),
    ],
    ["blank title", JSON.stringify({ version: 1, ...draft, title: "   " })],
    [
      "untrimmed title",
      JSON.stringify({ version: 1, ...draft, title: " Local title " }),
    ],
    [
      "invalid document",
      JSON.stringify({
        version: 1,
        ...draft,
        document: { nodes: "bad", edges: [] },
      }),
    ],
    [
      "unknown document field",
      JSON.stringify({
        version: 1,
        ...draft,
        document: { ...document, secret: true },
      }),
    ],
  ])("rejects %s", (_label, raw) => {
    expect(parseBoardDraft(raw)).toBeNull();
  });
});

describe("keepalive request body limits", () => {
  it("allows exactly the UTF-8 byte limit and rejects one byte over it", () => {
    expect(() =>
      validateKeepaliveBody("x".repeat(MAX_KEEPALIVE_BODY_BYTES), true),
    ).not.toThrow();
    expect(() =>
      validateKeepaliveBody("x".repeat(MAX_KEEPALIVE_BODY_BYTES + 1), true),
    ).toThrow(/keepalive/i);
  });

  it("measures UTF-8 bytes and does not apply the keepalive limit to normal saves", () => {
    expect(() =>
      validateKeepaliveBody(
        "\ud83d\ude00".repeat(MAX_KEEPALIVE_BODY_BYTES / 4),
        true,
      ),
    ).not.toThrow();
    expect(() =>
      validateKeepaliveBody(
        `\ud83d\ude00${"x".repeat(MAX_KEEPALIVE_BODY_BYTES - 3)}`,
        true,
      ),
    ).toThrow(/keepalive/i);
    expect(() =>
      validateKeepaliveBody("x".repeat(MAX_KEEPALIVE_BODY_BYTES + 1), false),
    ).not.toThrow();
  });

  it("constructs the save body once in the reusable helper", () => {
    const body = createBoardSaveBody(
      { title: "Board", document: { nodes: [], edges: [] } },
      "2026-09-21T10:11:12.123Z",
      false,
    );
    expect(JSON.parse(body)).toEqual({
      title: "Board",
      document: { nodes: [], edges: [] },
      updatedAt: "2026-09-21T10:11:12.123Z",
    });
  });
});
