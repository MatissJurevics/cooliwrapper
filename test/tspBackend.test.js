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
    assert.equal(plan.body.domains, "https://12345678-aaaa-bbbb-cccc-123456789abc.deploymentsv1.atrium.dubsof.com");
    assert.equal("autogenerate_domain" in plan.body, false);
    assert.equal(plan.body.instant_deploy, false);
    assert.equal(plan.body.ports_exposes, "8080");
    assert.equal(plan.body.health_check_path, "/health");
    assert.deepEqual(plan.postCreateUpdate, {
      ports_exposes: "8080",
      health_check_path: "/health",
      health_check_port: "8080",
      health_check_enabled: true
    });
    assert.equal(plan.postCreateProxyPort, "8080");
    assert.equal(plan.postCreateDomainPort, "8080");
    assert.equal(plan.postCreateDeploy, true);
    assert.match(dockerfile, /FROM ghcr\.io\/astral-sh\/uv:python3\.12-bookworm-slim/);
    assert.match(dockerfile, /apt-get install -y --no-install-recommends curl/);
    assert.match(dockerfile, /RUN mkdir -p \/data && chmod 0777 \/data/);
    assert.ok(dockerfile.includes("ENV TODODB_URL=sqlite:////data/todo_db.sqlite3"));
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

test("uses the generated Python service path and exposed port instead of hard-coded defaults", async () => {
  const { root, storageRoot, artifactStorageRoot } = await createTestRoots();

  try {
    await writeCurrentTinselArchive(root, {
      serviceDir: "admin_api",
      projectName: "AdminApp",
      port: 8000,
      dbDir: "project_db",
      dbEnv: "PROJECTDB_URL"
    });

    const plan = await buildTspBackendPlan({
      extractDir: root,
      requestManifest: { port: 8080 },
      defaults: coolifyDefaults(),
      staticSites: staticSiteConfig({ storageRoot, artifactStorageRoot }),
      uploadId: "12345678-aaaa-bbbb-cccc-123456789abc",
      publicBaseUrl: "https://uigendeploy.mati.ss"
    });

    const dockerfile = Buffer.from(plan.body.dockerfile, "base64").toString("utf8");
    assert.equal(plan.body.ports_exposes, "8000");
    assert.equal(plan.postCreateUpdate.ports_exposes, "8000");
    assert.equal(plan.postCreateProxyPort, "8000");
    assert.equal(plan.postCreateDomainPort, "8000");
    assert.equal(plan.local.servicePath, "services/admin_api");
    assert.equal(plan.local.port, "8000");
    assert.match(dockerfile, /WORKDIR \/bundle\/services\/admin_api/);
    assert.match(dockerfile, /EXPOSE 8000/);
    assert.ok(dockerfile.includes("ENV PROJECTDB_URL=sqlite:////data/project_db.sqlite3"));
    assert.ok(plan.warnings.some((warning) => warning.includes("Request manifest port 8080 was ignored")));
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
    assert.equal(plan.body.domains, "https://12345678-aaaa-bbbb-cccc-123456789abc.deploymentsv1.atrium.dubsof.com");
    assert.equal(plan.body.instant_deploy, false);
    assert.equal(plan.postCreateUpdate.ports_exposes, "8080");
    assert.equal(plan.postCreateDomainPort, "8080");
    assert.equal(plan.postCreateDeploy, true);
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

test("adds the backend port to Coolify generated TSP domains after create", async () => {
  const { root, storageRoot, artifactStorageRoot } = await createTestRoots();

  try {
    await writeCurrentTinselArchive(root);

    const plan = await buildTspBackendPlan({
      extractDir: root,
      requestManifest: {},
      defaults: coolifyDefaults(),
      staticSites: {
        storageRoot,
        artifactStorageRoot,
        domainSuffix: "",
        domainScheme: "https",
        maxArchiveBytes: 1024 * 1024
      },
      uploadId: "12345678-aaaa-bbbb-cccc-123456789abc",
      publicBaseUrl: "https://uigendeploy.mati.ss"
    });

    assert.equal(plan.body.autogenerate_domain, true);
    assert.equal("domains" in plan.body, false);
    assert.equal(plan.postCreateDomainPort, "8080");
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

async function writeCurrentTinselArchive(
  root,
  { serviceDir = "api", projectName = "TodoApp", port = 8080, dbDir = "todo_db", dbEnv = "TODODB_URL" } = {}
) {
  await fs.promises.writeFile(path.join(root, "manifest.json"), JSON.stringify({ name: projectName, services: [serviceDir] }));

  const apiRoot = path.join(root, "services", serviceDir);
  const appRoot = path.join(apiRoot, "app");
  const dbRoot = path.join(apiRoot, "databases", dbDir);
  await fs.promises.mkdir(appRoot, { recursive: true });
  await fs.promises.mkdir(dbRoot, { recursive: true });
  await fs.promises.writeFile(path.join(apiRoot, "requirements.txt"), "fastapi>=0.100\n-e ./databases\n");
  await fs.promises.writeFile(
    path.join(apiRoot, "pyproject.toml"),
    "[project]\nname='todo-api'\nversion='0.1.0'\nrequires-python='>=3.12'\n"
  );
  await fs.promises.writeFile(
    path.join(apiRoot, "Dockerfile"),
    [
      "FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim",
      "RUN mkdir -p /data && chmod 0777 /data",
      `ENV ${dbEnv}=sqlite:////data/${dbDir}.sqlite3`,
      `EXPOSE ${port}`,
      ""
    ].join("\n")
  );
  await fs.promises.writeFile(path.join(appRoot, "__init__.py"), "");
  await fs.promises.writeFile(path.join(appRoot, "__main__.py"), "from .main import main\nmain()\n");
  await fs.promises.writeFile(path.join(appRoot, "main.py"), `def main():\n    print('ok on ${port}')\n`);
  await fs.promises.writeFile(path.join(appRoot, "app.py"), "app = object()\n");
  await fs.promises.writeFile(path.join(dbRoot, "pyproject.toml"), `[project]\nname='${dbDir}'\nversion='0.1.0'\n`);
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
    domainSuffix: "deploymentsv1.atrium.dubsof.com",
    domainScheme: "https",
    maxArchiveBytes: 1024 * 1024
  };
}

async function cleanupTestRoots({ root, storageRoot, artifactStorageRoot }) {
  await fs.promises.rm(root, { recursive: true, force: true });
  await fs.promises.rm(storageRoot, { recursive: true, force: true });
  await fs.promises.rm(artifactStorageRoot, { recursive: true, force: true });
}
