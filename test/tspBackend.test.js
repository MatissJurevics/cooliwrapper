import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildTspBackendPlan } from "../src/tspBackend.js";

test("creates a python 3.12 dockerfile application plan for current Tinsel TSP backends", async () => {
  const { root, storageRoot, artifactStorageRoot } = await createTestRoots();

  try {
    await writeCurrentTinselArchive(root);

    const plan = await buildTspBackendPlan({
      extractDir: root,
      requestManifest: {},
      defaults: coolifyDefaults(),
      staticSites: staticSiteConfig({ storageRoot, artifactStorageRoot }),
      uploadId: "12345678-aaaa-bbbb-cccc-123456789abc",
      publicBaseUrl: "https://uigendeploy.mati.ss"
    });

    const dockerfile = Buffer.from(plan.body.dockerfile, "base64").toString("utf8");
    assert.equal(plan.type, "application");
    assert.equal(plan.mode, "dockerfile");
    assert.equal(plan.body.name, "todoapp-api-12345678");
    assert.equal(plan.body.domains, "https://todoapp-api-12345678.mati.ss");
    assert.equal("autogenerate_domain" in plan.body, false);
    assert.equal(plan.body.ports_exposes, "8080");
    assert.equal(plan.body.health_check_path, "/health");
    assert.match(dockerfile, /FROM ghcr\.io\/astral-sh\/uv:python3\.12-bookworm-slim/);
    assert.match(dockerfile, /apt-get install -y --no-install-recommends curl/);
    assert.match(dockerfile, /WORKDIR \/bundle\/services\/api/);
    assert.match(dockerfile, /RUN uv pip install --system \./);
    assert.match(dockerfile, /CMD \["python", "-m", "app"\]/);
    assert.doesNotMatch(dockerfile, /repository\/services\/api/);
    assert.equal(plan.local.servicePath, "services/api");
    assert.equal(plan.local.layout, "tinsel");
    assert.equal(plan.local.artifactPath, path.join(artifactStorageRoot, "12345678-aaaa-bbbb-cccc-123456789abc.tgz"));
    assert.equal((await fs.promises.stat(plan.local.artifactPath)).isFile(), true);
  } finally {
    await cleanupTestRoots({ root, storageRoot, artifactStorageRoot });
  }
});

test("keeps legacy repository/services/api TSP backends working", async () => {
  const { root, storageRoot, artifactStorageRoot } = await createTestRoots();

  try {
    await writeLegacyArchive(root);

    const plan = await buildTspBackendPlan({
      extractDir: root,
      requestManifest: {},
      defaults: coolifyDefaults(),
      staticSites: staticSiteConfig({ storageRoot, artifactStorageRoot }),
      uploadId: "12345678-aaaa-bbbb-cccc-123456789abc",
      publicBaseUrl: "https://uigendeploy.mati.ss"
    });

    const dockerfile = Buffer.from(plan.body.dockerfile, "base64").toString("utf8");
    assert.equal(plan.body.name, "todoapp-api-12345678");
    assert.equal(plan.body.domains, "https://todoapp-api-12345678.mati.ss");
    assert.match(dockerfile, /FROM python:3\.11-slim/);
    assert.match(dockerfile, /apt-get install -y --no-install-recommends curl/);
    assert.match(dockerfile, /repository\/services\/api/);
    assert.match(dockerfile, /CMD \["python", "-m", "api\.main"\]/);
    assert.equal(plan.local.servicePath, "repository/services/api");
    assert.equal(plan.local.layout, "legacy");
  } finally {
    await cleanupTestRoots({ root, storageRoot, artifactStorageRoot });
  }
});

test("reports missing current Tinsel backend files from services/api", async () => {
  const { root, storageRoot, artifactStorageRoot } = await createTestRoots();

  try {
    await fs.promises.writeFile(path.join(root, "manifest.json"), JSON.stringify({ name: "TodoApp" }));
    const apiRoot = path.join(root, "services", "api");
    await fs.promises.mkdir(apiRoot, { recursive: true });
    await fs.promises.writeFile(path.join(apiRoot, "requirements.txt"), "fastapi>=0.100\n");

    await assert.rejects(
      buildTspBackendPlan({
        extractDir: root,
        requestManifest: {},
        defaults: coolifyDefaults(),
        staticSites: staticSiteConfig({ storageRoot, artifactStorageRoot }),
        uploadId: "12345678-aaaa-bbbb-cccc-123456789abc",
        publicBaseUrl: "https://uigendeploy.mati.ss"
      }),
      /TSP archive requires services\/api\/pyproject\.toml/
    );
  } finally {
    await cleanupTestRoots({ root, storageRoot, artifactStorageRoot });
  }
});

async function createTestRoots() {
  return {
    root: await fs.promises.mkdtemp(path.join(os.tmpdir(), "cooliwrapper-tsp-test-")),
    storageRoot: await fs.promises.mkdtemp(path.join(os.tmpdir(), "cooliwrapper-tsp-storage-")),
    artifactStorageRoot: await fs.promises.mkdtemp(path.join(os.tmpdir(), "cooliwrapper-tsp-artifacts-"))
  };
}

async function writeCurrentTinselArchive(root) {
  await fs.promises.writeFile(path.join(root, "manifest.json"), JSON.stringify({ name: "TodoApp" }));

  const apiRoot = path.join(root, "services", "api");
  const appRoot = path.join(apiRoot, "app");
  const dbRoot = path.join(apiRoot, "databases", "todo_db");
  await fs.promises.mkdir(appRoot, { recursive: true });
  await fs.promises.mkdir(dbRoot, { recursive: true });
  await fs.promises.writeFile(path.join(apiRoot, "requirements.txt"), "fastapi>=0.100\n-e ./databases\n");
  await fs.promises.writeFile(
    path.join(apiRoot, "pyproject.toml"),
    "[project]\nname='todo-api'\nversion='0.1.0'\nrequires-python='>=3.12'\n"
  );
  await fs.promises.writeFile(path.join(apiRoot, "Dockerfile"), "FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim\n");
  await fs.promises.writeFile(path.join(appRoot, "__init__.py"), "");
  await fs.promises.writeFile(path.join(appRoot, "__main__.py"), "from .main import main\nmain()\n");
  await fs.promises.writeFile(path.join(appRoot, "main.py"), "def main():\n    print('ok')\n");
  await fs.promises.writeFile(path.join(appRoot, "app.py"), "app = object()\n");
  await fs.promises.writeFile(path.join(dbRoot, "pyproject.toml"), "[project]\nname='todo_db'\nversion='0.1.0'\n");
}

async function writeLegacyArchive(root) {
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
}

function coolifyDefaults() {
  return {
    project_uuid: "project",
    server_uuid: "server",
    environment_name: "production",
    destination_uuid: "destination"
  };
}

function staticSiteConfig({ storageRoot, artifactStorageRoot }) {
  return {
    storageRoot,
    artifactStorageRoot,
    domainSuffix: "mati.ss",
    domainScheme: "https",
    maxArchiveBytes: 1024 * 1024
  };
}

async function cleanupTestRoots({ root, storageRoot, artifactStorageRoot }) {
  await fs.promises.rm(root, { recursive: true, force: true });
  await fs.promises.rm(storageRoot, { recursive: true, force: true });
  await fs.promises.rm(artifactStorageRoot, { recursive: true, force: true });
}
