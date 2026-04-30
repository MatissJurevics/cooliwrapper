import fs from "node:fs";
import path from "node:path";
import { HttpError } from "./errors.js";
import {
  buildStaticSiteArtifactUrl,
  buildStaticSiteDockerfile,
  buildStaticSiteDomain,
  createArchiveArtifact,
  findStaticIndexHtml,
  prepareStaticSite
} from "./staticSite.js";

const COMPOSE_FILENAMES = new Set([
  "compose.yaml",
  "compose.yml",
  "docker-compose.yaml",
  "docker-compose.yml"
]);

const APPLICATION_MODES = new Set([
  "public",
  "private-github-app",
  "private-deploy-key",
  "dockerfile",
  "dockerimage",
  "dockercompose"
]);

export async function buildDeploymentPlan({
  extractDir,
  requestManifest,
  defaults,
  staticSites,
  uploadId,
  publicBaseUrl
}) {
  const embeddedManifest = await readEmbeddedManifest(extractDir);
  const autoManifest = await detectManifest(extractDir);
  const manifest = deepMerge(autoManifest, embeddedManifest, requestManifest);

  if (!manifest.type && manifest.mode) {
    manifest.type = manifest.mode;
  }

  if (manifest.type === "compose") manifest.type = "service";
  if (manifest.type === "redeploy") manifest.type = "deploy";
  if (manifest.type === "static") manifest.type = "static-html";

  switch (manifest.type) {
    case "static-html":
      return buildStaticHtmlPlan(manifest, extractDir, defaults, staticSites, uploadId, publicBaseUrl);
    case "service":
      return buildServicePlan(manifest, extractDir, defaults);
    case "application":
      return buildApplicationPlan(manifest, extractDir, defaults);
    case "deploy":
      return buildRedeployPlan(manifest);
    default:
      throw new HttpError(400, "ZIP needs coolify.json or a docker-compose.yml file");
  }
}

async function buildStaticHtmlPlan(
  manifest,
  extractDir,
  defaults,
  staticSites = {},
  uploadId = "manual",
  publicBaseUrl = ""
) {
  if (!staticSites.storageRoot) {
    throw new HttpError(500, "STATIC_SITE_STORAGE_ROOT is required for static HTML deployments");
  }

  if (!staticSites.artifactStorageRoot) {
    throw new HttpError(500, "STATIC_SITE_ARTIFACT_STORAGE_ROOT is required for static HTML deployments");
  }

  const site = await prepareStaticSite({
    extractDir,
    uploadId,
    storageRoot: staticSites.storageRoot
  });
  const artifact = await createArchiveArtifact(site.localPath, {
    artifactId: uploadId,
    artifactStorageRoot: staticSites.artifactStorageRoot,
    maxArchiveBytes: staticSites.maxArchiveBytes
  });
  const artifactUrl = buildStaticSiteArtifactUrl(publicBaseUrl, artifact);

  const domain = buildStaticSiteDomain(site.resourceSlug, staticSites);
  const coolifyOverrides = manifest.coolify || {};
  const domains = coolifyOverrides.domains || domain;
  const body = withDefaults(defaults, {
    ...coolifyOverrides,
    name: site.resourceSlug,
    description: manifest.description || `Static HTML site from ${site.title}`,
    instant_deploy: manifest.instant_deploy ?? manifest.instantDeploy ?? true,
    build_pack: "dockerfile",
    dockerfile: encodeBase64(buildStaticSiteDockerfile(artifactUrl)),
    ports_exposes: "80",
    is_force_https_enabled: true,
    autogenerate_domain: domains ? undefined : true,
    domains
  });

  requireFields(body, ["name", "project_uuid", "server_uuid", "destination_uuid", "dockerfile"], "static-html");

  return {
    type: "application",
    mode: "dockerfile",
    body: compactObject(body),
    local: {
      title: site.title,
      resourceSlug: site.resourceSlug,
      path: site.localPath,
      indexPath: site.indexPath,
      artifactPath: artifact.path,
      artifactBytes: artifact.bytes,
      artifactUrl
    },
    warnings: [
      "Static HTML was deployed through Coolify's Dockerfile application API. The generated Dockerfile downloads a tokenized static-site artifact from this wrapper during the Coolify build."
    ]
  };
}

export async function executeDeploymentPlan(plan, coolifyClient) {
  if (plan.type === "service") {
    const result = plan.uuid
      ? await coolifyClient.updateService(plan.uuid, plan.body)
      : await coolifyClient.createService(plan.body);

    return {
      action: plan.uuid ? "service.updated" : "service.created",
      result,
      local: plan.local,
      warnings: plan.warnings
    };
  }

  if (plan.type === "application") {
    const result = plan.uuid
      ? await coolifyClient.updateApplication(plan.uuid, plan.body)
      : await createApplicationWithPostCreateSteps(plan, coolifyClient);

    return {
      action: plan.uuid ? "application.updated" : `application.${plan.mode}.created`,
      result,
      local: plan.local,
      warnings: plan.warnings
    };
  }

  if (plan.type === "deploy") {
    const result = await coolifyClient.deploy(plan.body);
    return {
      action: "deployment.triggered",
      result,
      local: plan.local,
      warnings: plan.warnings
    };
  }

  throw new HttpError(500, `Unhandled deployment plan type: ${plan.type}`);
}

async function createApplicationWithPostCreateSteps(plan, coolifyClient) {
  const result = await coolifyClient.createApplication(plan.mode, plan.body);
  const uuid = result?.uuid;
  const postCreate = {};

  if (uuid && plan.postCreateUpdate) {
    const updateBody = await buildPostCreateUpdateBody(plan, uuid, coolifyClient);
    postCreate.update = await coolifyClient.updateApplication(uuid, updateBody);
  }

  if (uuid && plan.postCreateDeploy) {
    postCreate.deploy = await coolifyClient.deploy({ uuid });
  }

  if (Object.keys(postCreate).length === 0) {
    return result;
  }

  return {
    ...result,
    postCreate
  };
}

async function buildPostCreateUpdateBody(plan, uuid, coolifyClient) {
  const updateBody = {
    ...plan.postCreateUpdate
  };

  if ((plan.postCreateProxyPort || plan.postCreateDomainPort) && coolifyClient.getApplication) {
    const application = await coolifyClient.getApplication(uuid);

    if (plan.postCreateProxyPort) {
      updateBody.custom_labels = rewriteCoolifyProxyLabels(application?.custom_labels, plan.postCreateProxyPort);
    }

    if (plan.postCreateDomainPort) {
      updateBody.domains = addPortToDomains(plan.body?.domains || application?.fqdn || application?.domains, plan.postCreateDomainPort);
    }
  }

  return compactObject(updateBody);
}

function addPortToDomains(domains, port) {
  if (!domains) return undefined;

  return String(domains)
    .split(",")
    .map((domain) => addPortToDomain(domain.trim(), port))
    .join(",");
}

function addPortToDomain(domain, port) {
  if (!domain) return domain;

  try {
    const url = new URL(domain);
    url.port = String(port);
    return url.toString().replace(/\/$/, "");
  } catch {
    return domain.includes(":") ? domain : `${domain}:${port}`;
  }
}

function rewriteCoolifyProxyLabels(encodedLabels, port) {
  if (!encodedLabels) return undefined;

  const labels = Buffer.from(encodedLabels, "base64")
    .toString("utf8")
    .replace(/(loadbalancer\.server\.port=)\d+/g, `$1${port}`)
    .replace(/(upstreams )\d+/g, `$1${port}`);

  return Buffer.from(labels, "utf8").toString("base64");
}

async function buildServicePlan(manifest, extractDir, defaults) {
  const composePath = manifest.composeFile || manifest.compose_file;
  const resolvedComposePath = composePath
    ? resolveInsideExtractDir(extractDir, composePath)
    : await findComposeFile(extractDir);

  if (!resolvedComposePath) {
    throw new HttpError(400, "Service deployments require a docker-compose.yml, compose.yml, or composeFile");
  }

  const dockerComposeRaw = await fs.promises.readFile(resolvedComposePath, "utf8");
  const body = withDefaults(defaults, {
    type: manifest.serviceType || manifest.service_type || "custom",
    name: manifest.name,
    description: manifest.description,
    instant_deploy: manifest.instant_deploy ?? manifest.instantDeploy ?? true,
    docker_compose_raw: dockerComposeRaw,
    urls: manifest.urls,
    force_domain_override: manifest.force_domain_override ?? manifest.forceDomainOverride,
    ...(manifest.coolify || {})
  });

  if (!manifest.uuid) {
    requireFields(body, ["name", "project_uuid", "server_uuid", "destination_uuid"], "service");
  }

  return {
    type: "service",
    uuid: manifest.uuid,
    body: compactObject(body),
    warnings: []
  };
}

async function buildApplicationPlan(manifest, extractDir, defaults) {
  const mode = manifest.applicationMode || manifest.application_mode || manifest.mode;
  if (!APPLICATION_MODES.has(mode)) {
    throw new HttpError(400, `Application deployments require mode: ${Array.from(APPLICATION_MODES).join(", ")}`);
  }

  const body = withDefaults(defaults, {
    name: manifest.name,
    description: manifest.description,
    instant_deploy: manifest.instant_deploy ?? manifest.instantDeploy ?? true,
    ...(manifest.coolify || {})
  });

  const warnings = [];

  if (mode === "dockerfile") {
    const dockerfilePath = manifest.dockerfilePath || manifest.dockerfile_path || "Dockerfile";
    const resolvedDockerfilePath = resolveInsideExtractDir(extractDir, dockerfilePath);
    body.dockerfile = encodeBase64(await fs.promises.readFile(resolvedDockerfilePath, "utf8"));
    body.build_pack ||= "dockerfile";
  }

  if (mode === "dockercompose" && !body.docker_compose_raw) {
    const composePath = manifest.composeFile || manifest.compose_file;
    const resolvedComposePath = composePath
      ? resolveInsideExtractDir(extractDir, composePath)
      : await findComposeFile(extractDir);

    if (!resolvedComposePath) {
      throw new HttpError(400, "Docker Compose application deployments require docker_compose_raw or composeFile");
    }

    body.docker_compose_raw = await fs.promises.readFile(resolvedComposePath, "utf8");
  }

  requireApplicationFields(body, mode, Boolean(manifest.uuid));

  return {
    type: "application",
    mode,
    uuid: manifest.uuid,
    body: compactObject(body),
    warnings
  };
}

function buildRedeployPlan(manifest) {
  return {
    type: "deploy",
    body: {
      uuid: manifest.uuid,
      tag: manifest.tag,
      force: manifest.force,
      pr: manifest.pr
    },
    warnings: [
      "Deploy mode triggers Coolify to redeploy an existing resource; it does not upload extracted ZIP contents to Coolify."
    ]
  };
}

function requireApplicationFields(body, mode, isUpdate) {
  if (isUpdate) return;

  const commonRequired = ["name", "project_uuid", "server_uuid", "destination_uuid"];
  const modeRequired = {
    public: ["git_repository", "git_branch", "build_pack"],
    "private-github-app": ["github_app_uuid", "git_repository", "git_branch", "build_pack"],
    "private-deploy-key": ["private_key_uuid", "git_repository", "git_branch", "build_pack"],
    dockerfile: ["dockerfile"],
    dockerimage: ["docker_registry_image_name", "docker_registry_image_tag"],
    dockercompose: ["docker_compose_raw"]
  };

  requireFields(body, [...commonRequired, ...(modeRequired[mode] || [])], `application ${mode}`);
}

function requireFields(value, requiredFields, context) {
  const missing = requiredFields.filter((field) => value[field] === undefined || value[field] === "");
  if (missing.length > 0) {
    throw new HttpError(400, `Missing required ${context} field(s): ${missing.join(", ")}`);
  }
}

async function readEmbeddedManifest(extractDir) {
  const manifestPath = await findEmbeddedManifest(extractDir);
  if (!manifestPath) return {};

  try {
    return JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new HttpError(400, "coolify.json is not valid JSON", error.message);
    }
    throw error;
  }
}

async function findEmbeddedManifest(extractDir) {
  const candidates = (await collectFiles(extractDir))
    .filter((candidate) => path.basename(candidate).toLowerCase() === "coolify.json")
    .sort((a, b) => {
      const aDepth = path.relative(extractDir, a).split(path.sep).length;
      const bDepth = path.relative(extractDir, b).split(path.sep).length;
      return aDepth - bDepth || a.localeCompare(b);
    });

  return candidates[0];
}

async function detectManifest(extractDir) {
  const composeFile = await findComposeFile(extractDir);
  if (composeFile) {
    const relativeComposeFile = path.relative(extractDir, composeFile);
    return {
      type: "service",
      composeFile: relativeComposeFile
    };
  }

  const indexHtml = await findStaticIndexHtml(extractDir);
  if (indexHtml) {
    return {
      type: "static-html"
    };
  }

  return {};
}

async function findComposeFile(extractDir) {
  const candidates = await collectFiles(extractDir);
  const composeFiles = candidates.filter((candidate) => COMPOSE_FILENAMES.has(path.basename(candidate).toLowerCase()));

  if (composeFiles.length === 0) return undefined;

  composeFiles.sort((a, b) => {
    const aDepth = path.relative(extractDir, a).split(path.sep).length;
    const bDepth = path.relative(extractDir, b).split(path.sep).length;
    return aDepth - bDepth || a.localeCompare(b);
  });

  return composeFiles[0];
}

async function collectFiles(rootDir) {
  const results = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await fs.promises.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile()) {
        results.push(entryPath);
      }
    }
  }

  return results;
}

function resolveInsideExtractDir(extractDir, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new HttpError(400, `Path must be relative to the ZIP root: ${relativePath}`);
  }

  const root = path.resolve(extractDir);
  const resolved = path.resolve(root, relativePath);

  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new HttpError(400, `Path escapes ZIP root: ${relativePath}`);
  }

  return resolved;
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

function deepMerge(...objects) {
  const result = {};

  for (const object of objects) {
    if (!object || typeof object !== "object" || Array.isArray(object)) continue;

    for (const [key, value] of Object.entries(object)) {
      if (isPlainObject(value) && isPlainObject(result[key])) {
        result[key] = deepMerge(result[key], value);
      } else if (value !== undefined) {
        result[key] = value;
      }
    }
  }

  return result;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function encodeBase64(value) {
  return Buffer.from(value, "utf8").toString("base64");
}
