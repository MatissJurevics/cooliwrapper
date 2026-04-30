import { HttpError } from "./errors.js";

export function parseRequestManifest(body) {
  const manifest = {};

  for (const [key, value] of Object.entries(body || {})) {
    if (key === "manifest") continue;
    manifest[key] = parseFieldValue(value);
  }

  if (!body?.manifest) return manifest;

  try {
    return {
      ...manifest,
      ...JSON.parse(body.manifest)
    };
  } catch (error) {
    throw new HttpError(400, "Multipart field 'manifest' must be valid JSON", error.message);
  }
}

function parseFieldValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}
