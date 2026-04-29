import assert from "node:assert/strict";
import test from "node:test";
import { extractHtmlTitle, slugify } from "../src/staticSite.js";

test("extracts and decodes html titles", () => {
  assert.equal(extractHtmlTitle("<title> A &amp; B </title>"), "A & B");
});

test("slugifies titles for coolify resource names", () => {
  assert.equal(slugify("Launch Page: Hello World!"), "launch-page-hello-world");
});
