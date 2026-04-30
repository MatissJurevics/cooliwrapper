import fs from "node:fs";
import path from "node:path";
import { HttpError } from "./errors.js";
import { buildStaticSiteArtifactUrl, buildStaticSiteDomain, createArchiveArtifact, slugify } from "./staticSite.js";

const DEFAULT_PORT = "8080";
const TSP_LAYOUTS = [
  {
    name: "tinsel",
    servicePath: "services/api",
    requiredFiles: [
      "requirements.txt",
      "pyproject.toml",
      "app/__init__.py",
      "app/__main__.py",
      "app/main.py",
      "app/app.py"
    ],
    buildDockerfile: buildTinselBackendDockerfile
  },
  {
    name: "legacy",
    servicePath: "repository/services/api",
    requiredFiles: ["requirements.txt", "__init__.py", "main.py", "app.py"],
    buildDockerfile: buildLegacyBackendDockerfile
  }
];

export async function buildTspBackendPlan({ extractDir, requestManifest, defaults, staticSites, uploadId, publicBaseUrl }) {
  if (!staticSites?.storageRoot) {
    throw new HttpError(500, "STATIC_SITE_STORAGE_ROOT is required for TSP backend deployments");
  }

  if (!staticSites?.artifactStorageRoot) {
    throw new HttpError(500, "STATIC_SITE_ARTIFACT_STORAGE_ROOT is required for TSP backend deployments");
  }

  const manifest = await readTspManifest(extractDir);
  const layout = await detectTspLayout(extractDir);

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
    dockerfile: encodeBase64(layout.buildDockerfile({ artifactUrl, port })),
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
      servicePath: layout.servicePath,
      layout: layout.name,
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

function buildTinselBackendDockerfile({ artifactUrl, port }) {
  return [
    "FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim",
    "ENV PYTHONDONTWRITEBYTECODE=1",
    "ENV PYTHONUNBUFFERED=1",
    "ENV TODODB_URL=sqlite:////data/todo_db.sqlite3",
    "WORKDIR /bundle",
    `ADD ${artifactUrl} /tmp/tsp-repository.tgz`,
    "RUN apt-get update \\",
    "  && apt-get install -y --no-install-recommends curl \\",
    "  && rm -rf /var/lib/apt/lists/*",
    "RUN tar -xzf /tmp/tsp-repository.tgz -C /bundle && rm /tmp/tsp-repository.tgz",
    "WORKDIR /bundle/services/api",
    "RUN uv pip install --system .",
    `EXPOSE ${port}`,
    "CMD [\"python\", \"-m\", \"app\"]",
    ""
  ].join("\n");
}

function buildLegacyBackendDockerfile({ artifactUrl, port }) {
  return [
    "FROM python:3.11-slim",
    "ENV PYTHONDONTWRITEBYTECODE=1",
    "ENV PYTHONUNBUFFERED=1",
    "ENV TODODB_URL=sqlite:////data/todo_db.sqlite3",
    "WORKDIR /bundle",
    `ADD ${artifactUrl} /tmp/tsp-repository.tgz`,
    "RUN apt-get update \\",
    "  && apt-get install -y --no-install-recommends curl \\",
    "  && rm -rf /var/lib/apt/lists/*",
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

async function detectTspLayout(extractDir) {
  const results = [];

  for (const layout of TSP_LAYOUTS) {
    const rootExists = await pathExists(path.join(extractDir, layout.servicePath));
    const missing = await missingRequiredFiles(extractDir, layout);

    if (missing.length === 0) {
      return layout;
    }

    if (layout.name === "tinsel" && rootExists) {
      throw new HttpError(400, `TSP archive requires ${missing[0]}`);
    }

    results.push({
      layout,
      missing,
      rootExists
    });
  }

  const likelyLayout = results.find((result) => result.rootExists) || results[0];
  throw new HttpError(400, `TSP archive requires ${likelyLayout.missing[0]}`);
}

async function missingRequiredFiles(extractDir, layout) {
  const missing = [];

  for (const file of layout.requiredFiles) {
    const relativePath = path.join(layout.servicePath, file);
    try {
      await fs.promises.access(path.join(extractDir, relativePath), fs.constants.R_OK);
    } catch (error) {
      if (error.code === "ENOENT") {
        missing.push(toPosixPath(relativePath));
        continue;
      }

      throw error;
    }
  }

  return missing;
}

async function pathExists(filePath) {
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
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

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}
