import { canvasDocumentSchema } from "@foxcanvas/canvas-schema";
import type { CanvasDocument } from "./board";

export const MAX_KEEPALIVE_BODY_BYTES = 60_000;
const DRAFT_VERSION = 1;

export type BoardSaveSnapshot = { title: string; document: CanvasDocument };
export type BoardDraft = BoardSaveSnapshot & { baseUpdatedAt: string };

export function normalizeBoardTitle(value: string) {
  return value.trim() || "Untitled board";
}

const hasExactKeys = (value: Record<string, unknown>, expected: string[]) => {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === [...expected].sort()[index])
  );
};

const isCanonicalTimestamp = (value: unknown): value is string => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  )
    return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
};

export function parseBoardDraft(raw: string): BoardDraft | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const record = value as Record<string, unknown>;
    if (
      !hasExactKeys(record, ["version", "baseUpdatedAt", "title", "document"])
    )
      return null;
    if (
      record.version !== DRAFT_VERSION ||
      !isCanonicalTimestamp(record.baseUpdatedAt)
    )
      return null;
    if (
      typeof record.title !== "string" ||
      record.title.length < 1 ||
      record.title.length > 120 ||
      record.title !== record.title.trim()
    )
      return null;
    const document = canvasDocumentSchema.safeParse(record.document);
    if (!document.success) return null;
    return {
      baseUpdatedAt: record.baseUpdatedAt,
      title: record.title,
      document: document.data as CanvasDocument,
    };
  } catch {
    return null;
  }
}

export function serializeBoardDraft(draft: BoardDraft) {
  const serialized = JSON.stringify({ version: DRAFT_VERSION, ...draft });
  if (!parseBoardDraft(serialized))
    throw new Error("Cannot persist an invalid board draft");
  return serialized;
}

export function findMatchingBoardDraft(
  raw: string | null,
  baseUpdatedAt: string,
) {
  if (raw === null) return null;
  const draft = parseBoardDraft(raw);
  return draft?.baseUpdatedAt === baseUpdatedAt ? draft : null;
}

export function boardDraftStorageKey(boardId: string) {
  return `foxcanvas:board-draft:${boardId}`;
}

export function validateKeepaliveBody(body: string, keepalive: boolean) {
  if (
    keepalive &&
    new TextEncoder().encode(body).byteLength > MAX_KEEPALIVE_BODY_BYTES
  ) {
    throw new Error("Board is too large for a keepalive save");
  }
}

export function createBoardSaveBody(
  snapshot: BoardSaveSnapshot,
  updatedAt: string,
  keepalive: boolean,
) {
  const body = JSON.stringify({ ...snapshot, updatedAt });
  validateKeepaliveBody(body, keepalive);
  return body;
}
