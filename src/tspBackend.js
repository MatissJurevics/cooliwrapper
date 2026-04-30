import fs from "node:fs";
import path from "node:path";
import { HttpError } from "./errors.js";
import { buildStaticSiteArtifactUrl, buildStaticSiteDomain, createArchiveArtifact, slugify } from "./staticSite.js";

const API_ROOT = "repository/services/api";
const DEFAULT_PORT = "8080";

export async function buildTspBackendPlan({ extractDir, requestManifest, defaults, staticSites, uploadId, publicBaseUrl }) {
  if (!staticSites?.storageRoot) {
    throw new HttpError(500, "STATIC_SITE_STORAGE_ROOT is required for TSP backend deployments");
  }

  if (!staticSites?.artifactStorageRoot) {
    throw new HttpError(500, "STATIC_SITE_ARTIFACT_STORAGE_ROOT is required for TSP backend deployments");
  }

  const manifest = await readTspManifest(extractDir);
  const apiRoot = path.join(extractDir, API_ROOT);
  await validatePythonBackend(apiRoot);

  const projectName = requestManifest.name || manifest.name || "python-backend";
  const shortId = uploadId.replaceAll("-", "").slice(0, 8);
  const resourceSlug = `${slugify(projectName)}-api-${shortId}`;
  const localPath = path.join(staticSites.storageRoot, "tsp-backends", resourceSlug);

  await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
  await fs.promises.cp(extractDir, localPath, {
    recursive: true,
    errorOnExist: true
  });

  const artifact = await createArchiveArtifact(localPath, {
    artifactId: uploadId,
    artifactStorageRoot: staticSites.artifactStorageRoot,
    maxArchiveBytes: staticSites.maxArchiveBytes
  });
  const artifactUrl = buildStaticSiteArtifactUrl(publicBaseUrl, artifact);
  const port = String(requestManifest.port || requestManifest.coolify?.ports_exposes || DEFAULT_PORT);
  const coolifyOverrides = requestManifest.coolify || {};
  const domain = buildStaticSiteDomain(resourceSlug, staticSites);
  const domains = coolifyOverrides.domains || domain;
  const body = withDefaults(defaults, {
    ...coolifyOverrides,
    name: resourceSlug,
    description: requestManifest.description || `TSP Python backend from ${projectName}`,
    instant_deploy: requestManifest.instant_deploy ?? requestManifest.instantDeploy ?? true,
    build_pack: "dockerfile",
    dockerfile: encodeBase64(buildTspBackendDockerfile({ artifactUrl, port })),
    ports_exposes: port,
    health_check_path: requestManifest.health_check_path || requestManifest.healthCheckPath || "/health",
    health_check_port: port,
    health_check_enabled: true,
    autogenerate_domain: domains ? undefined : true,
    domains
  });

  requireFields(body, ["name", "project_uuid", "server_uuid", "destination_uuid", "dockerfile"], "tsp-backend");

  return {
    type: "application",
    mode: "dockerfile",
    body: compactObject(body),
    local: {
      projectName,
      servicePath: API_ROOT,
      resourceSlug,
      path: localPath,
      artifactPath: artifact.path,
      artifactBytes: artifact.bytes,
      artifactUrl,
      port
    },
    warnings: [
      "TSP Python backend was deployed through Coolify's Dockerfile application API. The generated Dockerfile downloads a tokenized TSP artifact from this wrapper during the Coolify build.",
      "The generated backend uses SQLite by default. Unless the generated backend is changed to use an external database, data persistence across rebuilds is not guaranteed."
    ]
  };
}

function buildTspBackendDockerfile({ artifactUrl, port }) {
  return [
    "FROM python:3.11-slim",
    "ENV PYTHONDONTWRITEBYTECODE=1",
    "ENV PYTHONUNBUFFERED=1",
    "ENV TODODB_URL=sqlite:////data/todo_db.sqlite3",
    "WORKDIR /bundle",
    `ADD ${artifactUrl} /tmp/tsp-repository.tgz`,
    "RUN tar -xzf /tmp/tsp-repository.tgz -C /bundle && rm /tmp/tsp-repository.tgz",
    "RUN mkdir -p /app /data && cp -R /bundle/repository/services/api /app/api",
    "RUN if [ -d /bundle/repository/databases/todo_db ]; then pip install --no-cache-dir /bundle/repository/databases/todo_db; fi \\",
    "  && sed '/^\\.\\.\\/databases\\/todo_db$/d' /app/api/requirements.txt > /tmp/requirements.txt \\",
    "  && pip install --no-cache-dir -r /tmp/requirements.txt",
    "WORKDIR /app",
    `EXPOSE ${port}`,
    "CMD [\"python\", \"-m\", \"api.main\"]",
    ""
  ].join("\n");
}

async function readTspManifest(extractDir) {
  const manifestPath = path.join(extractDir, "manifest.json");

  try {
    return JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new HttpError(400, "TSP archive requires manifest.json");
    }

    if (error instanceof SyntaxError) {
      throw new HttpError(400, "TSP manifest.json is not valid JSON", error.message);
    }

    throw error;
  }
}

async function validatePythonBackend(apiRoot) {
  const requiredFiles = ["requirements.txt", "__init__.py", "main.py", "app.py"];

  for (const file of requiredFiles) {
    try {
      await fs.promises.access(path.join(apiRoot, file), fs.constants.R_OK);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new HttpError(400, `TSP archive requires ${API_ROOT}/${file}`);
      }

      throw error;
    }
  }
}

function withDefaults(defaults, value) {
  return {
    ...defaults,
    ...value
  };
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined && entryValue !== null && entryValue !== "")
  );
}

function requireFields(value, requiredFields, context) {
  const missing = requiredFields.filter((field) => value[field] === undefined || value[field] === "");
  if (missing.length > 0) {
    throw new HttpError(400, `Missing required ${context} field(s): ${missing.join(", ")}`);
  }
}

function encodeBase64(value) {
  return Buffer.from(value, "utf8").toString("base64");
}
