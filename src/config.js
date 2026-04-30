import dotenv from "dotenv";

dotenv.config();

function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }

  return parsed;
}

function booleanFromEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export function normalizeCoolifyBaseUrl(rawBaseUrl) {
  const raw = rawBaseUrl || "https://coolify.mati.ss";
  const url = new URL(raw);
  let pathname = url.pathname.replace(/\/+$/, "");

  if (pathname === "") {
    pathname = "/api/v1";
  } else if (pathname === "/api") {
    pathname = "/api/v1";
  } else if (!pathname.endsWith("/api/v1")) {
    pathname = `${pathname}/api/v1`;
  }

  url.pathname = pathname;
  return url.toString().replace(/\/$/, "");
}

export const config = {
  host: process.env.HOST || "0.0.0.0",
  port: numberFromEnv("PORT", 3000),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  wrapperApiKey: process.env.WRAPPER_API_KEY || "",
  coolify: {
    baseUrl: normalizeCoolifyBaseUrl(process.env.COOLIFY_BASE_URL),
    token: process.env.COOLIFY_TOKEN || "",
    defaults: {
      project_uuid: process.env.COOLIFY_PROJECT_UUID || undefined,
      server_uuid: process.env.COOLIFY_SERVER_UUID || undefined,
      environment_name: process.env.COOLIFY_ENVIRONMENT_NAME || "production",
      environment_uuid: process.env.COOLIFY_ENVIRONMENT_UUID || undefined,
      destination_uuid: process.env.COOLIFY_DESTINATION_UUID || undefined
    }
  },
  uploads: {
    maxZipBytes: numberFromEnv("MAX_ZIP_BYTES", 100 * 1024 * 1024),
    maxExtractedBytes: numberFromEnv("MAX_EXTRACTED_BYTES", 500 * 1024 * 1024),
    maxExtractedFiles: numberFromEnv("MAX_EXTRACTED_FILES", 5000),
    keepUploads: booleanFromEnv("KEEP_UPLOADS")
  },
  staticSites: {
    storageRoot: process.env.STATIC_SITE_STORAGE_ROOT || "uploads/static-sites",
    artifactStorageRoot: process.env.STATIC_SITE_ARTIFACT_STORAGE_ROOT || "uploads/artifacts",
    domainSuffix: process.env.STATIC_SITE_DOMAIN_SUFFIX || "deploymentsv1.atrium.dubsof.com",
    domainScheme: process.env.STATIC_SITE_DOMAIN_SCHEME || "https",
    maxArchiveBytes: numberFromEnv("MAX_STATIC_ARCHIVE_BYTES", 25 * 1024 * 1024)
  }
};
