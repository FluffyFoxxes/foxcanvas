import bcrypt from "bcryptjs";
import {
  MAX_CANVAS_DOCUMENT_BYTES,
  canvasDocumentSchema,
} from "@foxcanvas/canvas-schema";
import cookieParser from "cookie-parser";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import { z, ZodError } from "zod";
import { aiConfig, isAiConfigured, loadAppConfig } from "./config.js";
import { prisma } from "./db.js";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

const COOKIE = "foxcanvas_session";
const authSchema = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(10).max(128),
});
const registerSchema = authSchema.extend({
  name: z.string().trim().min(1).max(60).default("Fox"),
});
const createBoardSchema = z.object({
  title: z.string().trim().min(1).max(120).default("Untitled board"),
});
const updateBoardSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    document: canvasDocumentSchema.optional(),
    updatedAt: z.string().datetime(),
  })
  .refine(
    (value) => value.title !== undefined || value.document !== undefined,
    "No changes supplied",
  );
const aiSchema = z.object({
  mode: z.enum([
    "brainstorm",
    "sticky-notes",
    "summarize",
    "cluster",
    "mind-map",
    "rewrite",
  ]),
  input: z.string().trim().min(1).max(20_000),
  context: canvasDocumentSchema.optional(),
});
const aiProviderSchema = z
  .object({
    choices: z
      .array(
        z
          .object({ message: z.object({ content: z.string() }).passthrough() })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();
const aiModelContentSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    summary: z.string().trim().min(1).max(10_000).optional(),
    items: z
      .array(
        z
          .object({
            text: z.string().trim().min(1).max(1_000),
            color: z
              .enum(["yellow", "coral", "mint", "blue", "purple", "gray"])
              .optional(),
            group: z.string().trim().min(1).max(120).optional(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
const MAX_AI_RESPONSE_BYTES = 1_000_000;
const MAX_API_JSON_BODY_BYTES = 520_000;

if (MAX_API_JSON_BODY_BYTES <= MAX_CANVAS_DOCUMENT_BYTES) {
  throw new Error("API JSON body limit must exceed the canvas document limit");
}

type Token = { sub: string };
type RateLimitOptions = { limit: number; windowMs: number };
type CreateAppOptions = {
  rateLimits?: Partial<Record<"register" | "login" | "ai", RateLimitOptions>>;
};
const defaultRateLimits: Record<"register" | "login" | "ai", RateLimitOptions> =
  {
    register: { limit: 5, windowMs: 60 * 60 * 1000 },
    login: { limit: 10, windowMs: 15 * 60 * 1000 },
    ai: { limit: 30, windowMs: 60 * 1000 },
  };
const tooManyRequests = { error: "Too many requests" };
const publicUser = (user: {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  createdAt: user.createdAt,
});
class InvalidStoredCanvasDocumentError extends Error {}
const boardJson = (board: {
  id: string;
  title: string;
  document: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}) => {
  try {
    return {
      ...board,
      document: canvasDocumentSchema.parse(JSON.parse(board.document)),
    };
  } catch {
    throw new InvalidStoredCanvasDocumentError(
      "Stored canvas document is invalid",
    );
  }
};
const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: "/",
};

function parseModelJson(content: string) {
  const clean = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed = aiModelContentSchema.parse(JSON.parse(clean));
  return {
    title: parsed.title ?? "AI result",
    items: parsed.items.map((item) => ({
      ...item,
      color: item.color ?? "yellow",
    })),
    ...(parsed.summary === undefined ? {} : { summary: parsed.summary }),
  };
}

async function readBoundedBody(
  response: globalThis.Response,
  maxBytes: number,
) {
  const statedLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(statedLength) && statedLength > maxBytes)
    throw new Error("AI response exceeds size limit");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("AI response exceeds size limit");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

export function createApp(options: CreateAppOptions = {}) {
  const config = loadAppConfig();
  const limits = { ...defaultRateLimits, ...options.rateLimits };
  const app = express();
  app.set("trust proxy", config.trustProxy);
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: MAX_API_JSON_BODY_BYTES }));
  app.use(cookieParser());

  const setSession = (res: Response, userId: string) => {
    res.cookie(
      COOKIE,
      jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: "7d" }),
      cookieOptions,
    );
  };
  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies?.[COOKIE];
    if (!token)
      return res.status(401).json({ error: "Authentication required" });
    try {
      req.userId = (jwt.verify(token, config.jwtSecret) as Token).sub;
      next();
    } catch {
      res.clearCookie(COOKIE, { path: "/" });
      return res.status(401).json({ error: "Authentication required" });
    }
  };
  const limiter = (
    settings: RateLimitOptions,
    keyGenerator?: (req: Request) => string,
  ) =>
    rateLimit({
      ...settings,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: tooManyRequests,
      ...(keyGenerator ? { keyGenerator } : {}),
    });
  const registerLimiter = limiter(limits.register);
  const loginLimiter = limiter(limits.login);
  const aiLimiter = limiter(limits.ai, (req) =>
    req.userId ? `user:${req.userId}` : `ip:${ipKeyGenerator(req.ip ?? "")}`,
  );

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.post("/api/auth/register", registerLimiter, async (req, res) => {
    const input = registerSchema.parse(req.body);
    const exists = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (exists)
      return res.status(409).json({ error: "Unable to create account" });
    const user = await prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: await bcrypt.hash(input.password, 12),
      },
    });
    setSession(res, user.id);
    return res.status(201).json({ user: publicUser(user) });
  });
  app.post("/api/auth/login", loginLimiter, async (req, res) => {
    const input = authSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email: input.email },
    });
    const valid = await bcrypt.compare(input.password, user!.passwordHash);

    if (!user || !valid)
      return res.status(401).json({ error: "Invalid email or password" });
    setSession(res, user.id);
    return res.json({ user: publicUser(user) });
  });
  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie(COOKIE, { ...cookieOptions, maxAge: undefined });
    return res.status(204).end();
  });
  app.get("/api/auth/me", requireAuth, async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user)
      return res.status(401).json({ error: "Authentication required" });
    return res.json({ user: publicUser(user) });
  });

  app.get("/api/boards", requireAuth, async (req, res) => {
    const boards = await prisma.board.findMany({
      where: { ownerId: req.userId },
      orderBy: { updatedAt: "desc" },
    });
    res.json({ boards: boards.map(boardJson) });
  });
  app.post("/api/boards", requireAuth, async (req, res) => {
    const input = createBoardSchema.parse(req.body);
    const board = await prisma.board.create({
      data: { title: input.title, ownerId: req.userId! },
    });
    res.status(201).json({ board: boardJson(board) });
  });
  app.get("/api/boards/:id", requireAuth, async (req, res) => {
    const board = await prisma.board.findFirst({
      where: { id: String(req.params.id), ownerId: req.userId },
    });
    if (!board) return res.status(404).json({ error: "Board not found" });
    return res.json({ board: boardJson(board) });
  });
  app.put("/api/boards/:id", requireAuth, async (req, res) => {
    const input = updateBoardSchema.parse(req.body);
    const changed = await prisma.board.updateMany({
      where: {
        id: String(req.params.id),
        ownerId: req.userId,
        updatedAt: new Date(input.updatedAt),
      },
      data: {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.document === undefined
          ? {}
          : { document: JSON.stringify(input.document) }),
        updatedAt: new Date(),
      },
    });
    if (!changed.count) {
      const exists = await prisma.board.findFirst({
        where: { id: String(req.params.id), ownerId: req.userId },
        select: { id: true },
      });
      return res.status(exists ? 409 : 404).json({
        error: exists ? "Board was changed elsewhere" : "Board not found",
      });
    }
    const board = await prisma.board.findUniqueOrThrow({
      where: { id: String(req.params.id) },
    });
    return res.json({ board: boardJson(board) });
  });
  app.delete("/api/boards/:id", requireAuth, async (req, res) => {
    const deleted = await prisma.board.deleteMany({
      where: { id: String(req.params.id), ownerId: req.userId },
    });
    return deleted.count
      ? res.status(204).end()
      : res.status(404).json({ error: "Board not found" });
  });

  app.get("/api/settings", requireAuth, (_req, res) =>
    res.json({
      aiConfigured: isAiConfigured(),
      model: isAiConfigured() ? aiConfig().model : null,
    }),
  );
  app.post("/api/ai", requireAuth, aiLimiter, async (req, res) => {
    const input = aiSchema.parse(req.body);
    if (!isAiConfigured())
      return res.status(503).json({
        error:
          "AI is not configured. Set AI_API_KEY and AI_MODEL on the server.",
      });
    const config = aiConfig();
    const instructions = `You are the FoxCanvas assistant. Mode: ${input.mode}. Return only JSON with {"title":string,"summary":string,"items":[{"text":string,"color":"yellow|coral|mint|blue|purple|gray","group":string?}]}. Keep it practical and concise.`;
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: instructions },
            {
              role: "user",
              content: `${input.input}\n\nCanvas context: ${JSON.stringify(input.context ?? {})}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      return res.status(502).json({
        error: timedOut
          ? "AI provider timed out. Please try again."
          : "Could not connect to the AI provider. Check the server's network connection and AI_BASE_URL.",
      });
    }
    if (!upstream.ok) {
      const message = (() => {
        if (upstream.status === 401 || upstream.status === 403)
          return "AI provider rejected the API key or access to this model. Check your key and model permissions."
        if (upstream.status === 402)
          return "AI provider reports insufficient credits. Check your provider balance."
        if (upstream.status === 429)
          return "AI provider rate limit reached. Please try again later."
        if (upstream.status === 404)
          return "AI provider could not find the model or endpoint. Check AI_MODEL and AI_BASE_URL."
        if (upstream.status >= 500)
          return "AI provider is unavailable. Please try again later."
        return "AI provider rejected the request. Check the model and provider settings.";
      })();
      return res
        .status(502)
        .json({ error: `${message} (Provider status: ${upstream.status})` });
    }
    try {
      const payload = aiProviderSchema.parse(
        JSON.parse(await readBoundedBody(upstream, MAX_AI_RESPONSE_BYTES)),
      );
      return res.json({
        result: parseModelJson(payload.choices[0].message.content),
      });
    } catch {
      return res.status(502).json({
        error:
          "AI provider returned an invalid response. Please try again or use another model.",
      });
    }
  });

  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof InvalidStoredCanvasDocumentError)
        return res.status(500).json({ error: "Internal server error" });
      if (error instanceof ZodError)
        return res
          .status(400)
          .json({ error: "Invalid request", issues: error.issues });
      if (
        error instanceof SyntaxError &&
        "status" in error &&
        error.status === 413
      )
        return res.status(413).json({ error: "Request too large" });
      if (
        error &&
        typeof error === "object" &&
        "type" in error &&
        error.type === "entity.too.large"
      )
        return res.status(413).json({ error: "Request too large" });
      console.error(error);
      return res.status(500).json({ error: "Internal server error" });
    },
  );
  return app;
}
