import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildTspBackendPlan } from "../src/tspBackend.js";

test("creates a dockerfile application plan for TSP python backends", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cooliwrapper-tsp-test-"));
  const storageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cooliwrapper-tsp-storage-"));
  const artifactStorageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cooliwrapper-tsp-artifacts-"));

  try {
    await fs.promises.writeFile(path.join(root, "manifest.json"), JSON.stringify({ name: "TodoApp" }));

    const apiRoot = path.join(root, "repository", "services", "api");
    const dbRoot = path.join(root, "repository", "databases", "todo_db");
    await fs.promises.mkdir(apiRoot, { recursive: true });
    await fs.promises.mkdir(dbRoot, { recursive: true });
    await fs.promises.writeFile(path.join(apiRoot, "__init__.py"), "");
    await fs.promises.writeFile(path.join(apiRoot, "main.py"), "print('ok')\n");
    await fs.promises.writeFile(path.join(apiRoot, "app.py"), "app = object()\n");
    await fs.promises.writeFile(path.join(apiRoot, "requirements.txt"), "fastapi>=0.100\n../databases/todo_db\n");
    await fs.promises.writeFile(path.join(dbRoot, "pyproject.toml"), "[project]\nname='todo_db'\nversion='0.1.0'\n");

    const plan = await buildTspBackendPlan({
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
    assert.equal(plan.body.name, "todoapp-api-12345678");
    assert.equal(plan.body.domains, "https://todoapp-api-12345678.deploymentsv1.dubsof.com");
    assert.equal("autogenerate_domain" in plan.body, false);
    assert.equal(plan.body.ports_exposes, "8080");
    assert.equal(plan.body.health_check_path, "/health");
    assert.match(dockerfile, /FROM python:3\.11-slim/);
    assert.match(dockerfile, /ADD https:\/\/uigendeploy\.deploymentsv1\.dubsof\.com\/artifacts\/12345678-aaaa-bbbb-cccc-123456789abc\/site\.tgz\?token=/);
    assert.match(dockerfile, /CMD \["python", "-m", "api\.main"\]/);
    assert.equal(plan.local.servicePath, "repository/services/api");
    assert.equal(plan.local.artifactPath, path.join(artifactStorageRoot, "12345678-aaaa-bbbb-cccc-123456789abc.tgz"));
    assert.equal((await fs.promises.stat(plan.local.artifactPath)).isFile(), true);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
    await fs.promises.rm(storageRoot, { recursive: true, force: true });
    await fs.promises.rm(artifactStorageRoot, { recursive: true, force: true });
  }
});
