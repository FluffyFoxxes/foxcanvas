import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";
import { MAX_CANVAS_DOCUMENT_BYTES } from "@foxcanvas/canvas-schema";
import { prisma } from "../src/db.js";
import { createApp } from "../src/app.js";

process.env.JWT_SECRET = "test-only-R7!mQ2#vL9@xP4$kN8&cW5-z";
const app = createApp({
  rateLimits: {
    register: { limit: 10_000, windowMs: 60_000 },
    login: { limit: 10_000, windowMs: 60_000 },
    ai: { limit: 10_000, windowMs: 60_000 },
  },
});

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(async () => {
  await prisma.board.deleteMany();
  await prisma.user.deleteMany();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function register(email = "fox@example.com") {
  return request(app)
    .post("/api/auth/register")
    .send({ email, password: "correct-horse-12", name: "Fox" });
}

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

describe("authentication", () => {
  it("registers, sets an httpOnly lax cookie, returns me, and logs out", async () => {
    const registered = await register();
    expect(registered.status).toBe(201);
    expect(registered.headers["set-cookie"][0]).toMatch(
      /HttpOnly.*SameSite=Lax/,
    );
    expect(registered.body.user).toMatchObject({
      email: "fox@example.com",
      name: "Fox",
    });
    expect(registered.body.user.passwordHash).toBeUndefined();
    const cookie = registered.headers["set-cookie"];
    expect(
      (await request(app).get("/api/auth/me").set("Cookie", cookie)).status,
    ).toBe(200);
    expect(
      (await request(app).post("/api/auth/logout").set("Cookie", cookie))
        .status,
    ).toBe(204);
  });

  it("uses generic login errors and rejects invalid payloads", async () => {
    await register();
    const wrong = await request(app)
      .post("/api/auth/login")
      .send({ email: "fox@example.com", password: "wrong-password" });
    const missing = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "wrong-password" });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body).toEqual(missing.body);
    expect(
      (
        await request(app)
          .post("/api/auth/register")
          .send({ email: "bad", password: "x" })
      ).status,
    ).toBe(400);
  });

  it("rejects oversized JSON and emits security headers", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        email: "x@y.co",
        password: "long-enough-pass",
        name: "x".repeat(530_000),
      });
    expect(response.status).toBe(413);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("application rate limits", () => {
  it("limits registration and login by client IP with a generic response", async () => {
    const limited = createApp({
      rateLimits: {
        register: { limit: 1, windowMs: 60_000 },
        login: { limit: 1, windowMs: 60_000 },
        ai: { limit: 100, windowMs: 60_000 },
      },
    });

    expect(limited.get("trust proxy")).toBe(false);
    expect(
      (
        await request(limited).post("/api/auth/register").send({
          email: "first@example.com",
          password: "correct-horse-12",
          name: "Fox",
        })
      ).status,
    ).toBe(201);
    const blockedRegister = await request(limited)
      .post("/api/auth/register")
      .send({
        email: "second@example.com",
        password: "correct-horse-12",
        name: "Fox",
      });
    expect(blockedRegister.status).toBe(429);
    expect(blockedRegister.body).toEqual({ error: "Too many requests" });

    const firstLogin = await request(limited)
      .post("/api/auth/login")
      .send({ email: "first@example.com", password: "wrong-password" });
    expect(firstLogin.status).toBe(401);
    const blockedLogin = await request(limited)
      .post("/api/auth/login")
      .send({ email: "first@example.com", password: "wrong-password" });
    expect(blockedLogin.status).toBe(429);
    expect(blockedLogin.body).toEqual({ error: "Too many requests" });
  });

  it("keys authenticated AI limits by user rather than shared IP", async () => {
    process.env.AI_API_KEY = "server-only";
    process.env.AI_MODEL = "model";
    const first = await register("rate-ai-one@example.com");
    const second = await register("rate-ai-two@example.com");
    const limited = createApp({
      rateLimits: {
        register: { limit: 100, windowMs: 60_000 },
        login: { limit: 100, windowMs: 60_000 },
        ai: { limit: 1, windowMs: 60_000 },
      },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"items":[]}' } }],
          }),
          { status: 200 },
        ),
    );
    const payload = { mode: "brainstorm", input: "ideas" };

    expect(
      (
        await request(limited)
          .post("/api/ai")
          .set("Cookie", first.headers["set-cookie"])
          .send(payload)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(limited)
          .post("/api/ai")
          .set("Cookie", second.headers["set-cookie"])
          .send(payload)
      ).status,
    ).toBe(200);
    const blocked = await request(limited)
      .post("/api/ai")
      .set("Cookie", first.headers["set-cookie"])
      .send(payload);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: "Too many requests" });
    fetchMock.mockRestore();
  });
});

describe("boards", () => {
  it("supports owner CRUD with parsed documents", async () => {
    const auth = await register();
    const cookie = auth.headers["set-cookie"];
    const created = await request(app)
      .post("/api/boards")
      .set("Cookie", cookie)
      .send({ title: "Ideas" });
    expect(created.status).toBe(201);
    expect(created.body.board.document).toEqual({ nodes: [], edges: [] });
    const listed = await request(app).get("/api/boards").set("Cookie", cookie);
    expect(listed.body.boards).toHaveLength(1);
    const updated = await request(app)
      .put(`/api/boards/${created.body.board.id}`)
      .set("Cookie", cookie)
      .send({
        title: "Roadmap",
        document: {
          nodes: [
            {
              id: "n1",
              type: "sticky",
              position: { x: 0, y: 0 },
              data: { text: "Ship", color: "yellow" },
            },
          ],
          edges: [],
        },
        updatedAt: created.body.board.updatedAt,
      });
    expect(updated.status).toBe(200);
    expect(updated.body.board.title).toBe("Roadmap");
    expect(updated.body.board.document.nodes).toHaveLength(1);
    expect(
      (
        await request(app)
          .delete(`/api/boards/${created.body.board.id}`)
          .set("Cookie", cookie)
      ).status,
    ).toBe(204);
  });

  it("enforces ownership and optimistic updatedAt conflicts", async () => {
    const owner = await register("owner@example.com");
    const board = await request(app)
      .post("/api/boards")
      .set("Cookie", owner.headers["set-cookie"])
      .send({ title: "Private" });
    const stranger = await register("stranger@example.com");
    expect(
      (
        await request(app)
          .get(`/api/boards/${board.body.board.id}`)
          .set("Cookie", stranger.headers["set-cookie"])
      ).status,
    ).toBe(404);
    const first = await request(app)
      .put(`/api/boards/${board.body.board.id}`)
      .set("Cookie", owner.headers["set-cookie"])
      .send({ title: "Fresh", updatedAt: board.body.board.updatedAt });
    expect(first.status).toBe(200);
    const stale = await request(app)
      .put(`/api/boards/${board.body.board.id}`)
      .set("Cookie", owner.headers["set-cookie"])
      .send({ title: "Stale", updatedAt: board.body.board.updatedAt });
    expect(stale.status).toBe(409);
  });

  it("rejects malformed documents on write", async () => {
    const auth = await register();
    const cookie = auth.headers["set-cookie"];
    const created = await request(app)
      .post("/api/boards")
      .set("Cookie", cookie)
      .send({ title: "Ideas" });
    const duplicate = {
      id: "same",
      type: "sticky",
      position: { x: 0, y: 0 },
      data: { text: "A", color: "yellow" },
    };

    const response = await request(app)
      .put(`/api/boards/${created.body.board.id}`)
      .set("Cookie", cookie)
      .send({
        document: { nodes: [duplicate, duplicate], edges: [] },
        updatedAt: created.body.board.updatedAt,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid request");
  });

  it("saves a valid document larger than 100kb but below the aggregate document limit", async () => {
    const auth = await register();
    const created = await request(app)
      .post("/api/boards")
      .set("Cookie", auth.headers["set-cookie"])
      .send({ title: "Large ideas" });
    const document = stickyDocument(11);
    expect(Buffer.byteLength(JSON.stringify(document), "utf8")).toBeGreaterThan(
      100_000,
    );
    expect(Buffer.byteLength(JSON.stringify(document), "utf8")).toBeLessThan(
      MAX_CANVAS_DOCUMENT_BYTES,
    );

    const response = await request(app)
      .put(`/api/boards/${created.body.board.id}`)
      .set("Cookie", auth.headers["set-cookie"])
      .send({
        document,
        updatedAt: created.body.board.updatedAt,
      });

    expect(response.status).toBe(200);
    expect(response.body.board.document.nodes).toHaveLength(11);
  });

  it("returns schema 400 rather than parser 413 for a document above the aggregate limit", async () => {
    const auth = await register();
    const created = await request(app)
      .post("/api/boards")
      .set("Cookie", auth.headers["set-cookie"])
      .send({ title: "Too large" });
    const document = stickyDocument(51);
    const requestBody = { document, updatedAt: created.body.board.updatedAt };
    expect(Buffer.byteLength(JSON.stringify(document), "utf8")).toBeGreaterThan(
      MAX_CANVAS_DOCUMENT_BYTES,
    );
    expect(Buffer.byteLength(JSON.stringify(requestBody), "utf8")).toBeLessThan(
      520_000,
    );

    const response = await request(app)
      .put(`/api/boards/${created.body.board.id}`)
      .set("Cookie", auth.headers["set-cookie"])
      .send(requestBody);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid request");
    expect(response.body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringMatching(/serialized UTF-8 bytes/i),
        }),
      ]),
    );
  });

  it("fails safely when a stored document is malformed", async () => {
    const auth = await register();
    const stored = await prisma.board.create({
      data: {
        title: "Broken",
        ownerId: auth.body.user.id,
        document: '{"nodes":"not-an-array","edges":[]}',
      },
    });

    const response = await request(app)
      .get(`/api/boards/${stored.id}`)
      .set("Cookie", auth.headers["set-cookie"]);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Internal server error" });
  });
});

describe("AI proxy", () => {
  it("reports configuration and gives useful 503 when absent", async () => {
    delete process.env.AI_API_KEY;
    const auth = await register();
    expect(
      (
        await request(app)
          .get("/api/settings")
          .set("Cookie", auth.headers["set-cookie"])
      ).body.aiConfigured,
    ).toBe(false);
    const response = await request(app)
      .post("/api/ai")
      .set("Cookie", auth.headers["set-cookie"])
      .send({ mode: "brainstorm", input: "launch ideas" });
    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/not configured/i);
  });

  it("validates modes and normalizes OpenAI-compatible structured output", async () => {
    process.env.AI_API_KEY = "server-only";
    process.env.AI_BASE_URL = "https://ai.example/v1";
    process.env.AI_MODEL = "model";
    const auth = await register();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '```json\n{\"title\":\"Plan\",\"items\":[{\"text\":\"Ship it\",\"color\":\"yellow\"}]}\n```',
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    expect(
      (
        await request(app)
          .post("/api/ai")
          .set("Cookie", auth.headers["set-cookie"])
          .send({ mode: "unknown", input: "x" })
      ).status,
    ).toBe(400);
    const result = await request(app)
      .post("/api/ai")
      .set("Cookie", auth.headers["set-cookie"])
      .send({ mode: "sticky-notes", input: "launch plan" });
    expect(result.status).toBe(200);
    expect(result.body.result.items[0]).toMatchObject({
      text: "Ship it",
      color: "yellow",
    });
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer server-only",
    });
    fetchMock.mockRestore();
  });

  it("accepts a strict practical result with optional presentation fields", async () => {
    process.env.AI_API_KEY = "server-only";
    process.env.AI_MODEL = "model";
    const auth = await register();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [
                    { text: "Ship it" },
                    { text: "Tell users", color: "mint", group: "Launch" },
                  ],
                  summary: "Two next steps",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await request(app)
      .post("/api/ai")
      .set("Cookie", auth.headers["set-cookie"])
      .send({ mode: "brainstorm", input: "launch plan" });

    expect(result.status).toBe(200);
    expect(result.body.result).toEqual({
      title: "AI result",
      summary: "Two next steps",
      items: [
        { text: "Ship it", color: "yellow" },
        { text: "Tell users", color: "mint", group: "Launch" },
      ],
    });
  });

  it("returns a generic 502 without logging raw content for every unsupported model result shape", async () => {
    process.env.AI_API_KEY = "server-only";
    process.env.AI_MODEL = "model";
    const auth = await register();
    const invalidContents = [
      "{}",
      "null",
      "[]",
      '{"items":null}',
      '{"items":{}}',
      '{"items":["raw-secret-item"]}',
      '{"items":[{"text":""}]}',
      `{"items":[{"text":"${"x".repeat(1001)}"}]}`,
      '{"items":[{"text":"Idea","color":"chartreuse"}]}',
      `{"items":[{"text":"Idea","group":"${"g".repeat(121)}"}]}`,
      '{"title":42,"items":[]}',
      '{"summary":"   ","items":[]}',
      JSON.stringify({
        items: Array.from({ length: 101 }, () => ({ text: "Idea" })),
      }),
      '{"items":[{"text":"Idea","unexpected":"raw-secret-field"}]}',
      '{"items":[],"unexpected":"raw-secret-root"}',
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch");
    for (const content of invalidContents) {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
          status: 200,
        }),
      );
    }
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    for (const _content of invalidContents) {
      const result = await request(app)
        .post("/api/ai")
        .set("Cookie", auth.headers["set-cookie"])
        .send({ mode: "brainstorm", input: "launch plan" });
      expect(result.status).toBe(502);
      expect(result.body).toEqual({
        error:
          "AI provider returned an invalid response. Please try again or use another model.",
      });
    }
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("reports actionable provider status without exposing its response", async () => {
    process.env.AI_API_KEY = "server-only";
    process.env.AI_MODEL = "model";
    const auth = await register();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    for (const [status, expected] of [
      [401, "API key"],
      [402, "credits"],
      [404, "model or endpoint"],
      [429, "rate limit"],
      [503, "unavailable"],
    ] as const) {
      fetchMock.mockResolvedValueOnce(
        new Response("secret provider details", { status }),
      );
      const result = await request(app)
        .post("/api/ai")
        .set("Cookie", auth.headers["set-cookie"])
        .send({ mode: "brainstorm", input: "test" });
      expect(result.status).toBe(502);
      expect(result.body.error).toContain(expected);
      expect(result.body.error).toContain(String(status));
      expect(result.body.error).not.toContain("secret provider details");
    }
  });

  it("returns a generic 502 when the AI provider is unreachable", async () => {
    process.env.AI_API_KEY = "server-only";
    process.env.AI_BASE_URL = "https://ai.example/v1";
    process.env.AI_MODEL = "model";
    const auth = await register();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("secret upstream detail"));
    const result = await request(app)
      .post("/api/ai")
      .set("Cookie", auth.headers["set-cookie"])
      .send({ mode: "brainstorm", input: "launch plan" });
    expect(result.status).toBe(502);
    expect(result.body).toEqual({
      error:
        "Could not connect to the AI provider. Check the server's network connection and AI_BASE_URL.",
    });
    expect(JSON.stringify(result.body)).not.toContain("secret upstream detail");
    fetchMock.mockRestore();
  });

  it("returns the same generic 502 for malformed successful provider JSON without logging it", async () => {
    process.env.AI_API_KEY = "server-only";
    process.env.AI_BASE_URL = "https://ai.example/v1";
    process.env.AI_MODEL = "model";
    const auth = await register();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"secret-upstream-body":', { status: 200 }),
    );
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const result = await request(app)
      .post("/api/ai")
      .set("Cookie", auth.headers["set-cookie"])
      .send({ mode: "brainstorm", input: "launch plan" });

    expect(result.status).toBe(502);
    expect(result.body).toEqual({
      error:
        "AI provider returned an invalid response. Please try again or use another model.",
    });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("rejects a successful provider body larger than one megabyte before parsing", async () => {
    process.env.AI_API_KEY = "server-only";
    process.env.AI_MODEL = "model";
    const auth = await register();
    const oversized = JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              items: [{ text: "x".repeat(1_100_000) }],
            }),
          },
        },
      ],
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(oversized, { status: 200 }),
    );

    const result = await request(app)
      .post("/api/ai")
      .set("Cookie", auth.headers["set-cookie"])
      .send({ mode: "brainstorm", input: "launch plan" });

    expect(result.status).toBe(502);
    expect(result.body).toEqual({
      error:
        "AI provider returned an invalid response. Please try again or use another model.",
    });
  });
});
