export type AppConfig = {
  jwtSecret: string;
  port: number;
  trustProxy: false | number | string;
};

const knownJwtPlaceholders = [
  "replace-with-at-least-32-random-characters",
  "change-me-to-a-long-production-secret-value",
  "changeme",
  "your-jwt-secret",
];

function validatedJwtSecret(value = process.env.JWT_SECRET) {
  if (!value) throw new Error("JWT_SECRET is required");
  if (value.length < 32)
    throw new Error("JWT_SECRET must contain at least 32 characters");
  const normalized = value.trim().toLowerCase();
  if (
    knownJwtPlaceholders.some((placeholder) => normalized.includes(placeholder))
  ) {
    throw new Error("JWT_SECRET must not use a known placeholder");
  }
  if (/^(.{1,16})\1+$/.test(value)) {
    throw new Error("JWT_SECRET must not be a trivially repeated value");
  }
  return value;
}

function trustProxySetting(
  value = process.env.TRUST_PROXY,
): AppConfig["trustProxy"] {
  if (!value || value === "false") return false;
  if (/^[1-9]\d*$/.test(value)) return Number(value);
  if (["loopback", "linklocal", "uniquelocal"].includes(value)) return value;
  throw new Error(
    "TRUST_PROXY must be false, a positive proxy-hop count, or a named private subnet",
  );
}

export function loadAppConfig(): AppConfig {
  const port = Number(process.env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error("PORT must be an integer between 1 and 65535");
  return Object.freeze({
    jwtSecret: validatedJwtSecret(),
    port,
    trustProxy: trustProxySetting(),
  });
}

export function aiConfig() {
  return {
    baseUrl: (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(
      /\/$/,
      "",
    ),
    apiKey: process.env.AI_API_KEY || "",
    model: process.env.AI_MODEL || "",
  };
}

export function isAiConfigured() {
  const config = aiConfig();
  return Boolean(config.apiKey && config.model);
}

export function jwtSecret() {
  return validatedJwtSecret();
}
