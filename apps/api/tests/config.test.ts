import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { jwtSecret, loadAppConfig } from "../src/config.js";

const original = process.env.JWT_SECRET;

afterEach(() => {
  if (original === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = original;
});

describe("JWT configuration", () => {
  it("rejects a missing secret", () => {
    delete process.env.JWT_SECRET;
    expect(() => jwtSecret()).toThrow(/JWT_SECRET/);
  });

  it("rejects a short secret", () => {
    process.env.JWT_SECRET = "too-short";
    expect(() => jwtSecret()).toThrow(/32/);
  });

  it.each([
    "replace-with-at-least-32-random-characters",
    "change-me-to-a-long-production-secret-value",
    "a".repeat(64),
    "abcd".repeat(16),
  ])("rejects placeholder or trivially repeated secret %j", (secret) => {
    process.env.JWT_SECRET = secret;
    expect(() => loadAppConfig()).toThrow(/JWT_SECRET/);
  });

  it("accepts a sufficiently varied secret with at least 32 characters", () => {
    const secret = "test-only-R7!mQ2#vL9@xP4$kN8&cW5-z";
    process.env.JWT_SECRET = secret;
    expect(jwtSecret()).toBe(secret);
  });

  it("fails closed while creating the app, before any route is used", () => {
    process.env.JWT_SECRET = "replace-with-at-least-32-random-characters";
    expect(() => createApp()).toThrow(/JWT_SECRET/);
  });
});
