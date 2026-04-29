import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCoolifyBaseUrl } from "../src/config.js";

test("normalizes bare Coolify hosts to api v1", () => {
  assert.equal(normalizeCoolifyBaseUrl("https://coolify.mati.ss"), "https://coolify.mati.ss/api/v1");
});

test("keeps existing api v1 base URLs", () => {
  assert.equal(normalizeCoolifyBaseUrl("https://coolify.mati.ss/api/v1/"), "https://coolify.mati.ss/api/v1");
});
