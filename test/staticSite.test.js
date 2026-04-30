import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extractHtmlTitle, prepareStaticSite, slugify } from "../src/staticSite.js";

test("extracts and decodes html titles", () => {
  assert.equal(extractHtmlTitle("<title> A &amp; B </title>"), "A & B");
});

test("slugifies titles for coolify resource names", () => {
  assert.equal(slugify("Launch Page: Hello World!"), "launch-page-hello-world");
});

test("rejects unbuilt frontend source references", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cooliwrapper-static-test-"));
  const storageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cooliwrapper-static-storage-"));

  try {
    await fs.promises.mkdir(path.join(root, "src"));
    await fs.promises.writeFile(
      path.join(root, "index.html"),
      '<!doctype html><html><head><title>Vite App</title></head><body><script type="module" src="/src/main.tsx"></script></body></html>'
    );
    await fs.promises.writeFile(path.join(root, "src/main.tsx"), "console.log('source');\n");

    await assert.rejects(
      prepareStaticSite({
        extractDir: root,
        uploadId: "12345678-aaaa-bbbb-cccc-123456789abc",
        storageRoot
      }),
      /Static HTML appears to be unbuilt: index\.html references \/src\/main\.tsx/
    );
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
    await fs.promises.rm(storageRoot, { recursive: true, force: true });
  }
});

test("rejects missing static assets", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cooliwrapper-static-test-"));
  const storageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cooliwrapper-static-storage-"));

  try {
    await fs.promises.writeFile(
      path.join(root, "index.html"),
      '<!doctype html><html><head><title>Missing Asset</title></head><body><script type="module" src="/assets/app.js"></script></body></html>'
    );

    await assert.rejects(
      prepareStaticSite({
        extractDir: root,
        uploadId: "12345678-aaaa-bbbb-cccc-123456789abc",
        storageRoot
      }),
      /index\.html references missing asset: \/assets\/app\.js/
    );
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
    await fs.promises.rm(storageRoot, { recursive: true, force: true });
  }
});

test("rejects missing favicons referenced by index.html", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cooliwrapper-static-test-"));
  const storageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cooliwrapper-static-storage-"));

  try {
    await fs.promises.writeFile(
      path.join(root, "index.html"),
      '<!doctype html><html><head><title>Icon Missing</title><link rel="icon" href="/favicon.svg"></head><body>Hello</body></html>'
    );

    await assert.rejects(
      prepareStaticSite({
        extractDir: root,
        uploadId: "12345678-aaaa-bbbb-cccc-123456789abc",
        storageRoot
      }),
      /index\.html references missing asset: \/favicon\.svg/
    );
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
    await fs.promises.rm(storageRoot, { recursive: true, force: true });
  }
});
