import fs from "node:fs";
import path from "node:path";
import { HttpError } from "./errors.js";
import { buildStaticSiteArtifactUrl, buildStaticSiteDomain, createArchiveArtifact, slugify } from "./staticSite.js";

const DEFAULT_PORT = "8080";
const TINSEL_REQUIRED_FILES = [
  "requirements.txt",
  "pyproject.toml",
  "app/__init__.py",
  "app/__main__.py",
  "app/main.py",
  "app/app.py"
];
const TSP_LAYOUTS = [
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
  const layout = await detectTspLayout(extractDir, { manifest, requestManifest });
  const runtime = layout.name === "tinsel" ? await inspectTinselBackendRuntime(extractDir, layout.servicePath) : {};
  const portResolution = resolveBackendPort({ requestManifest, detectedPort: runtime.port });

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
  const port = portResolution.port;
  const coolifyOverrides = requestManifest.coolify || {};
  const domain = buildStaticSiteDomain(uploadId, staticSites);
  const domains = coolifyOverrides.domains || domain;
  const desiredInstantDeploy = requestManifest.instant_deploy ?? requestManifest.instantDeploy ?? true;
  const body = withDefaults(defaults, {
    ...coolifyOverrides,
    name: resourceSlug,
    description: requestManifest.description || `TSP Python backend from ${projectName}`,
    instant_deploy: false,
    build_pack: "dockerfile",
    dockerfile: encodeBase64(layout.buildDockerfile({ artifactUrl, port, servicePath: layout.servicePath, runtime })),
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
    postCreateUpdate: compactObject({
      ports_exposes: port,
      health_check_path: body.health_check_path,
      health_check_port: port,
      health_check_enabled: true
    }),
    postCreateProxyPort: port,
    postCreateDomainPort: port,
    postCreateDeploy: desiredInstantDeploy,
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
      ...(portResolution.warnings || []),
      ...(runtime.warnings || []),
      "TSP Python backend was deployed through Coolify's Dockerfile application API. The generated Dockerfile downloads a tokenized TSP artifact from this wrapper during the Coolify build.",
      "The generated backend uses SQLite by default. Unless the generated backend is changed to use an external database, data persistence across rebuilds is not guaranteed."
    ]
  };
}

function buildTinselBackendDockerfile({ artifactUrl, port, servicePath, runtime = {} }) {
  const sqliteEnvLines = runtime.sqliteEnvLines || [];
  const sqliteSetup = sqliteEnvLines.length > 0
    ? ["RUN mkdir -p /data && chmod 0777 /data", ...sqliteEnvLines, ""]
    : [];

  return [
    "FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim",
    "ENV PYTHONDONTWRITEBYTECODE=1",
    "ENV PYTHONUNBUFFERED=1",
    ...sqliteSetup,
    "WORKDIR /bundle",
    `ADD ${artifactUrl} /tmp/tsp-repository.tgz`,
    "RUN apt-get update \\",
    "  && apt-get install -y --no-install-recommends curl \\",
    "  && rm -rf /var/lib/apt/lists/*",
    "RUN tar -xzf /tmp/tsp-repository.tgz -C /bundle && rm /tmp/tsp-repository.tgz",
    `WORKDIR /bundle/${servicePath}`,
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

async function detectTspLayout(extractDir, { manifest = {}, requestManifest = {} } = {}) {
  const tinselLayout = await detectTinselLayout(extractDir, { manifest, requestManifest });
  if (tinselLayout) {
    return tinselLayout;
  }

  const results = [];

  for (const layout of TSP_LAYOUTS) {
    const rootExists = await pathExists(path.join(extractDir, layout.servicePath));
    const missing = await missingRequiredFiles(extractDir, layout);

    if (missing.length === 0) {
      return layout;
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

async function detectTinselLayout(extractDir, { manifest = {}, requestManifest = {} } = {}) {
  const servicesRoot = path.join(extractDir, "services");
  if (!(await pathExists(servicesRoot))) return undefined;

  const serviceDirs = await listDirectories(servicesRoot);
  if (serviceDirs.length === 0) return undefined;

  const candidates = [];
  const partials = [];

  for (const serviceDir of serviceDirs) {
    const servicePath = path.posix.join("services", serviceDir);
    const layout = {
      name: "tinsel",
      servicePath,
      requiredFiles: TINSEL_REQUIRED_FILES,
      buildDockerfile: buildTinselBackendDockerfile
    };
    const missing = await missingRequiredFiles(extractDir, layout);

    if (missing.length === 0) {
      candidates.push(layout);
    } else {
      partials.push({ layout, missing });
    }
  }

  const requestedServiceDirs = serviceSelectors(requestManifest);
  if (requestedServiceDirs.length > 0) {
    const requested = candidates.find((candidate) => requestedServiceDirs.includes(serviceDirName(candidate.servicePath)));
    if (requested) return requested;

    const partial = partials.find((candidate) => requestedServiceDirs.includes(serviceDirName(candidate.layout.servicePath)));
    if (partial) {
      throw new HttpError(400, `TSP archive requires ${partial.missing[0]}`);
    }

    throw new HttpError(
      400,
      `TSP archive does not contain requested service '${requestedServiceDirs[0]}'. Available services: ${serviceDirs.join(", ")}`
    );
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  const manifestServices = Array.isArray(manifest.services) ? manifest.services.map((service) => snakeName(String(service))) : [];
  if (manifestServices.length === 1) {
    const service = candidates.find((candidate) => manifestServices.includes(serviceDirName(candidate.servicePath)));
    if (service) return service;
  }

  if (candidates.length > 1) {
    throw new HttpError(
      400,
      `TSP archive contains multiple service backends; send manifest.service with one of: ${candidates
        .map((candidate) => serviceDirName(candidate.servicePath))
        .join(", ")}`
    );
  }

  if (partials.length > 0) {
    const likely = partials.find((candidate) => candidate.layout.servicePath === "services/api") || partials[0];
    throw new HttpError(400, `TSP archive requires ${likely.missing[0]}`);
  }

  return undefined;
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

async function inspectTinselBackendRuntime(extractDir, servicePath) {
  const serviceRoot = path.join(extractDir, servicePath);
  const dockerfile = await readTextIfExists(path.join(serviceRoot, "Dockerfile"));
  const mainPy = await readTextIfExists(path.join(serviceRoot, "app", "main.py"));
  const port = detectExposedPort(dockerfile) || detectPythonUvicornPort(mainPy);
  const sqliteEnvLines = await collectSqliteEnvLines({ serviceRoot, dockerfile });

  return {
    port,
    sqliteEnvLines
  };
}

function resolveBackendPort({ requestManifest, detectedPort }) {
  const requestedRaw = requestManifest.port || requestManifest.coolify?.ports_exposes;
  const requestedPort = normalizePort(requestedRaw);
  const archivePort = normalizePort(detectedPort);
  const warnings = [];

  if (requestedPort && archivePort && requestedPort !== archivePort) {
    warnings.push(
      `Request manifest port ${requestedPort} was ignored because the generated Python service exposes ${archivePort}.`
    );
  }

  return {
    port: archivePort || requestedPort || DEFAULT_PORT,
    warnings
  };
}

function detectExposedPort(dockerfile) {
  const match = dockerfile.match(/^\s*EXPOSE\s+(\d{1,5})\b/m);
  return match ? match[1] : undefined;
}

function detectPythonUvicornPort(source) {
  const match = source.match(/\bport\s*=\s*(\d{1,5})\b/);
  return match ? match[1] : undefined;
}

async function collectSqliteEnvLines({ serviceRoot, dockerfile }) {
  const lines = [];
  const fromDockerfile = Array.from(
    dockerfile.matchAll(/^\s*ENV\s+([A-Z][A-Z0-9_]*_URL)=(sqlite:\/\/\/{2}data\/[A-Za-z0-9_.-]+\.sqlite3)\s*$/gm),
    (match) => `ENV ${match[1]}=${match[2]}`
  );
  lines.push(...fromDockerfile);

  if (lines.length === 0) {
    const databaseRoot = path.join(serviceRoot, "databases");
    for (const dbDir of await listDirectories(databaseRoot)) {
      const clientPy = await readTextIfExists(path.join(databaseRoot, dbDir, "client.py"));
      const match = clientPy.match(/os\.environ\.get\(\s*['"]([A-Z][A-Z0-9_]*_URL)['"]\s*,\s*['"]sqlite:\/\/\/\.\/[^'"]+['"]\s*\)/);
      if (match) {
        lines.push(`ENV ${match[1]}=sqlite:////data/${dbDir}.sqlite3`);
      }
    }
  }

  return Array.from(new Set(lines)).sort();
}

function normalizePort(value) {
  if (value === undefined || value === null || value === "") return undefined;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new HttpError(400, `Invalid TSP backend port: ${value}`);
  }

  return String(port);
}

function serviceSelectors(requestManifest) {
  const raw =
    requestManifest.service ||
    requestManifest.serviceName ||
    requestManifest.service_name ||
    requestManifest.servicePath ||
    requestManifest.service_path;

  if (!raw) return [];

  const value = String(raw).trim().replace(/^\/+|\/+$/g, "");
  const basename = value.startsWith("services/") ? value.slice("services/".length).split("/")[0] : value.split("/")[0];
  return Array.from(new Set([basename, snakeName(basename)].filter(Boolean)));
}

function serviceDirName(servicePath) {
  return path.posix.basename(servicePath);
}

function snakeName(value) {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

async function listDirectories(rootDir) {
  try {
    const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function readTextIfExists(filePath) {
  try {
    return await fs.promises.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
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
