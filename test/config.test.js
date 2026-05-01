import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCoolifyBaseUrl, normalizeStaticSiteDomainSuffix } from "../src/config.js";

test("normalizes bare Coolify hosts to api v1", () => {
  assert.equal(normalizeCoolifyBaseUrl("https://coolify.mati.ss"), "https://coolify.mati.ss/api/v1");
});

test("keeps existing api v1 base URLs", () => {
  assert.equal(normalizeCoolifyBaseUrl("https://coolify.mati.ss/api/v1/"), "https://coolify.mati.ss/api/v1");
});

test("uses the default static domain suffix only when the env var is unset", () => {
  assert.equal(normalizeStaticSiteDomainSuffix(undefined), "deploymentsv1.atrium.dubsof.com");
});

test("allows an empty static domain suffix to use Coolify generated domains", () => {
  assert.equal(normalizeStaticSiteDomainSuffix(""), undefined);
  assert.equal(normalizeStaticSiteDomainSuffix("   "), undefined);
});
