import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildDeploymentPlan } from "../src/manifest.js";

test("auto-detects compose files as service deployments", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cooliwrapper-test-"));
  try {
    await fs.promises.writeFile(
      path.join(root, "docker-compose.yml"),
      "services:\n  web:\n    image: nginx:alpine\n"
    );

    const plan = await buildDeploymentPlan({
      extractDir: root,
      requestManifest: { name: "web" },
      defaults: {
        project_uuid: "project",
        server_uuid: "server",
        environment_name: "production",
        destination_uuid: "destination"
      }
    });

    assert.equal(plan.type, "service");
    assert.equal(plan.body.name, "web");
    assert.match(plan.body.docker_compose_raw, /nginx:alpine/);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("reads nested coolify.json from zipped folder layouts", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cooliwrapper-test-"));
  try {
    const appDir = path.join(root, "app");
    await fs.promises.mkdir(appDir);
    await fs.promises.writeFile(
      path.join(appDir, "coolify.json"),
      JSON.stringify({ type: "deploy", uuid: "resource", force: true })
    );

    const plan = await buildDeploymentPlan({
      extractDir: root,
      requestManifest: {},
      defaults: {}
    });

    assert.equal(plan.type, "deploy");
    assert.deepEqual(plan.body, {
      uuid: "resource",
      tag: undefined,
      force: true,
      pr: undefined
    });
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("allows existing service updates without create-only Coolify fields", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cooliwrapper-test-"));
  try {
    await fs.promises.writeFile(path.join(root, "compose.yml"), "services: {}\n");

    const plan = await buildDeploymentPlan({
      extractDir: root,
      requestManifest: { uuid: "service-uuid" },
      defaults: {}
    });

    assert.equal(plan.type, "service");
    assert.equal(plan.uuid, "service-uuid");
    assert.equal(plan.body.docker_compose_raw, "services: {}\n");
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("auto-detects static HTML, stores it locally, and creates dockerfile app plan", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cooliwrapper-test-"));
  const storageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cooliwrapper-storage-"));
  const artifactStorageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cooliwrapper-artifacts-"));

  try {
    await fs.promises.writeFile(
      path.join(root, "index.html"),
      "<!doctype html><html><head><title>Launch Page</title></head><body>Hello</body></html>"
    );
    await fs.promises.writeFile(path.join(root, "style.css"), "body { color: black; }\n");

    const plan = await buildDeploymentPlan({
      extractDir: root,
      requestManifest: {},
      defaults: {
        project_uuid: "project",
        server_uuid: "server",
        environment_name: "production",
        destination_uuid: "destination"
      },
      staticSites: {
        storageRoot,
        artifactStorageRoot,
        domainSuffix: "deploymentsv1.dubsof.com",
        domainScheme: "https",
        maxArchiveBytes: 1024 * 1024
      },
      uploadId: "12345678-aaaa-bbbb-cccc-123456789abc",
      publicBaseUrl: "https://uigendeploy.deploymentsv1.dubsof.com"
    });

    const dockerfile = Buffer.from(plan.body.dockerfile, "base64").toString("utf8");
    assert.equal(plan.type, "application");
    assert.equal(plan.mode, "dockerfile");
    assert.equal(plan.body.name, "launch-page-12345678");
    assert.equal(plan.body.domains, "https://launch-page-12345678.deploymentsv1.dubsof.com");
    assert.equal("autogenerate_domain" in plan.body, false);
    assert.match(dockerfile, /FROM nginx:alpine/);
    assert.match(dockerfile, /ADD https:\/\/uigendeploy\.deploymentsv1\.dubsof\.com\/artifacts\//);
    assert.match(dockerfile, /https:\/\/uigendeploy\.deploymentsv1\.dubsof\.com\/artifacts\/12345678-aaaa-bbbb-cccc-123456789abc\/site\.tgz\?token=/);
    assert.equal(plan.local.title, "Launch Page");
    assert.equal(plan.local.artifactPath, path.join(artifactStorageRoot, "12345678-aaaa-bbbb-cccc-123456789abc.tgz"));
    assert.ok(plan.local.artifactBytes > 0);
    assert.equal(
      await fs.promises.readFile(path.join(storageRoot, "launch-page-12345678", "style.css"), "utf8"),
      "body { color: black; }\n"
    );
    assert.equal((await fs.promises.stat(plan.local.artifactPath)).isFile(), true);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
    await fs.promises.rm(storageRoot, { recursive: true, force: true });
    await fs.promises.rm(artifactStorageRoot, { recursive: true, force: true });
  }
});
