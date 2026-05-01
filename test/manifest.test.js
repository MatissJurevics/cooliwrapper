import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildDeploymentPlan, executeDeploymentPlan } from "../src/manifest.js";

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

test("auto-detects static HTML before compose files when both are present", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cooliwrapper-test-"));
  const storageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cooliwrapper-storage-"));
  const artifactStorageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cooliwrapper-artifacts-"));

  try {
    await fs.promises.writeFile(
      path.join(root, "index.html"),
      "<!doctype html><html><head><title>Playground Build</title></head><body>Hello</body></html>"
    );
    await fs.promises.writeFile(
      path.join(root, "docker-compose.yml"),
      "services:\n  web:\n    image: nginx:alpine\n"
    );

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
        domainSuffix: "deploymentsv1.atrium.dubsof.com",
        domainScheme: "https",
        maxArchiveBytes: 1024 * 1024
      },
      uploadId: "12345678-aaaa-bbbb-cccc-123456789abc",
      publicBaseUrl: "https://uigendeploy.mati.ss"
    });

    assert.equal(plan.type, "application");
    assert.equal(plan.mode, "dockerfile");
    assert.equal(plan.body.name, "playground-build-12345678");
    assert.equal(plan.body.domains, "https://12345678-aaaa-bbbb-cccc-123456789abc.deploymentsv1.atrium.dubsof.com");
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
    await fs.promises.rm(storageRoot, { recursive: true, force: true });
    await fs.promises.rm(artifactStorageRoot, { recursive: true, force: true });
  }
});

test("uses Coolify generated domains when static site suffix is empty", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cooliwrapper-test-"));
  const storageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cooliwrapper-storage-"));
  const artifactStorageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cooliwrapper-artifacts-"));

  try {
    await fs.promises.writeFile(
      path.join(root, "index.html"),
      "<!doctype html><html><head><title>Generated Domain</title></head><body>Hello</body></html>"
    );

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
        domainSuffix: "",
        domainScheme: "https",
        maxArchiveBytes: 1024 * 1024
      },
      uploadId: "12345678-aaaa-bbbb-cccc-123456789abc",
      publicBaseUrl: "https://uigendeploy.mati.ss"
    });

    assert.equal(plan.body.autogenerate_domain, true);
    assert.equal("domains" in plan.body, false);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
    await fs.promises.rm(storageRoot, { recursive: true, force: true });
    await fs.promises.rm(artifactStorageRoot, { recursive: true, force: true });
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

test("runs application post-create update and deploy steps", async () => {
  const calls = [];
  const result = await executeDeploymentPlan(
    {
      type: "application",
      mode: "dockerfile",
      body: {
        name: "api",
        instant_deploy: false
      },
      postCreateUpdate: {
        ports_exposes: "8080"
      },
      postCreateProxyPort: "8080",
      postCreateDomainPort: "8080",
      postCreateDeploy: true
    },
    {
      async createApplication(mode, body) {
        calls.push(["create", mode, body]);
        return { uuid: "app-uuid" };
      },
      async getApplication(uuid) {
        calls.push(["get", uuid]);
        return {
          fqdn: "http://app.example.test",
          custom_labels: Buffer.from(
            [
              "traefik.http.services.http-0-app.loadbalancer.server.port=80",
              "caddy_0.handle_path.0_reverse_proxy={{upstreams 80}}"
            ].join("\n"),
            "utf8"
          ).toString("base64")
        };
      },
      async updateApplication(uuid, body) {
        calls.push(["update", uuid, body]);
        return { uuid };
      },
      async deploy(body) {
        calls.push(["deploy", body]);
        return { deployment_uuid: "deployment-uuid" };
      }
    }
  );

  assert.deepEqual(calls, [
    ["create", "dockerfile", { name: "api", instant_deploy: false }],
    ["get", "app-uuid"],
    [
      "update",
      "app-uuid",
      {
        ports_exposes: "8080",
        domains: "http://app.example.test:8080",
        custom_labels: Buffer.from(
          [
            "traefik.http.services.http-0-app.loadbalancer.server.port=8080",
            "caddy_0.handle_path.0_reverse_proxy={{upstreams 8080}}"
          ].join("\n"),
          "utf8"
        ).toString("base64")
      }
    ],
    ["deploy", { uuid: "app-uuid" }]
  ]);
  assert.equal(result.result.uuid, "app-uuid");
  assert.equal(result.result.domains, "http://app.example.test:8080");
  assert.equal(result.result.postCreate.update.uuid, "app-uuid");
  assert.equal(result.result.postCreate.deploy.deployment_uuid, "deployment-uuid");
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
        domainSuffix: "deploymentsv1.atrium.dubsof.com",
        domainScheme: "https",
        maxArchiveBytes: 1024 * 1024
      },
      uploadId: "12345678-aaaa-bbbb-cccc-123456789abc",
      publicBaseUrl: "https://uigendeploy.mati.ss"
    });

    const dockerfile = Buffer.from(plan.body.dockerfile, "base64").toString("utf8");
    assert.equal(plan.type, "application");
    assert.equal(plan.mode, "dockerfile");
    assert.equal(plan.body.name, "launch-page-12345678");
    assert.equal(plan.body.domains, "https://12345678-aaaa-bbbb-cccc-123456789abc.deploymentsv1.atrium.dubsof.com");
    assert.equal("autogenerate_domain" in plan.body, false);
    assert.match(dockerfile, /FROM nginx:alpine/);
    assert.match(dockerfile, /ADD https:\/\/uigendeploy\.mati\.ss\/artifacts\//);
    assert.match(dockerfile, /https:\/\/uigendeploy\.mati\.ss\/artifacts\/12345678-aaaa-bbbb-cccc-123456789abc\/site\.tgz\?token=/);
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
