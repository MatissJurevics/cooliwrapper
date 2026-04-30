import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { HttpError } from "./errors.js";

const TAR_BLOCK_SIZE = 512;

export async function prepareStaticSite({ extractDir, uploadId, storageRoot }) {
  const indexPath = await findStaticIndexHtml(extractDir);
  if (!indexPath) {
    throw new HttpError(400, "Static HTML ZIPs require an index.html file");
  }

  const indexHtml = await fs.promises.readFile(indexPath, "utf8");
  const title = extractHtmlTitle(indexHtml);
  if (!title) {
    throw new HttpError(400, "index.html must contain a non-empty <title> tag");
  }

  const siteRoot = path.dirname(indexPath);
  const validation = await validateStaticHtmlReferences({ indexHtml, indexPath, siteRoot });
  const titleSlug = slugify(title);
  const shortId = uploadId.replaceAll("-", "").slice(0, 8);
  const resourceSlug = `${titleSlug}-${shortId}`;
  const localPath = path.join(storageRoot, resourceSlug);

  await fs.promises.mkdir(storageRoot, { recursive: true });
  await fs.promises.cp(siteRoot, localPath, {
    recursive: true,
    errorOnExist: true,
    filter(source) {
      return path.basename(source).toLowerCase() !== "coolify.json";
    }
  });

  return {
    title,
    titleSlug,
    resourceSlug,
    localPath,
    indexPath: path.join(localPath, "index.html"),
    warnings: validation.warnings
  };
}

export async function createArchiveArtifact(sourceRoot, { artifactId, artifactStorageRoot, maxArchiveBytes }) {
  const archive = gzipSync(await createTarArchive(sourceRoot));

  if (archive.length > maxArchiveBytes) {
    throw new HttpError(
      413,
      `Static site archive is ${archive.length} bytes, above MAX_STATIC_ARCHIVE_BYTES=${maxArchiveBytes}. Use a Git or Docker registry workflow for larger sites.`
    );
  }

  const token = randomBytes(32).toString("hex");
  const artifactPath = path.join(artifactStorageRoot, `${artifactId}.tgz`);
  const metadataPath = path.join(artifactStorageRoot, `${artifactId}.json`);

  await fs.promises.mkdir(artifactStorageRoot, { recursive: true });
  await fs.promises.writeFile(artifactPath, archive, { flag: "wx" });
  await fs.promises.writeFile(
    metadataPath,
    JSON.stringify(
      {
        id: artifactId,
        token,
        bytes: archive.length,
        createdAt: new Date().toISOString()
      },
      null,
      2
    ),
    { flag: "wx" }
  );

  return {
    id: artifactId,
    token,
    bytes: archive.length,
    path: artifactPath,
    metadataPath
  };
}

export function buildStaticSiteArtifactUrl(publicBaseUrl, artifact) {
  if (!publicBaseUrl) {
    throw new HttpError(500, "PUBLIC_BASE_URL is required for static HTML deployments");
  }

  const baseUrl = publicBaseUrl.endsWith("/") ? publicBaseUrl : `${publicBaseUrl}/`;
  const url = new URL(`artifacts/${artifact.id}/site.tgz`, baseUrl);
  url.searchParams.set("token", artifact.token);
  return url.toString();
}

export function buildStaticSiteDockerfile(artifactUrl) {
  return [
    "FROM nginx:alpine",
    `ADD ${artifactUrl} /tmp/site.tgz`,
    "RUN rm -rf /usr/share/nginx/html/* \\",
    "  && tar -xzf /tmp/site.tgz -C /usr/share/nginx/html \\",
    "  && rm /tmp/site.tgz",
    ""
  ].join("\n");
}

export function buildStaticSiteDomain(deploymentId, { domainSuffix, domainScheme }) {
  if (!domainSuffix) return undefined;

  const suffix = domainSuffix.replace(/^\.+/, "").replace(/\.+$/, "");
  const subdomain = slugify(deploymentId);
  return `${domainScheme}://${subdomain}.${suffix}`;
}

export function slugify(value) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");

  return slug || "static-site";
}

export function extractHtmlTitle(html) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return "";

  return decodeHtmlEntities(match[1])
    .replace(/\s+/g, " ")
    .trim();
}

export async function validateStaticHtmlReferences({ indexHtml, indexPath, siteRoot }) {
  const references = extractHtmlReferences(indexHtml);
  const warnings = [];

  for (const reference of references) {
    if (!isLocalAssetReference(reference.path)) continue;

    if (isUnbuiltSourceReference(reference.path)) {
      throw new HttpError(
        400,
        `Static HTML appears to be unbuilt: index.html references ${reference.path}. Upload the built static output instead of source files. For Vite apps, run npm run build and zip the dist directory.`
      );
    }

    const resolved = resolveAssetPath({ siteRoot, indexPath, assetPath: reference.path });
    if (!resolved) continue;

    const exists = await pathExists(resolved);
    if (exists) continue;

    const message = `index.html references missing asset: ${reference.path}`;
    if (reference.required) {
      throw new HttpError(400, `${message}. Upload the complete built static output.`);
    }

    warnings.push(message);
  }

  return { warnings };
}

export async function findStaticIndexHtml(extractDir) {
  const files = await collectFiles(extractDir);
  const indexFiles = files.filter((file) => path.basename(file).toLowerCase() === "index.html");

  if (indexFiles.length === 0) return undefined;

  indexFiles.sort((a, b) => {
    const aDepth = path.relative(extractDir, a).split(path.sep).length;
    const bDepth = path.relative(extractDir, b).split(path.sep).length;
    return aDepth - bDepth || a.localeCompare(b);
  });

  return indexFiles[0];
}

function extractHtmlReferences(html) {
  return [
    ...extractScriptReferences(html),
    ...extractLinkReferences(html)
  ];
}

function extractScriptReferences(html) {
  return Array.from(html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi), (match) => ({
    kind: "script",
    path: decodeHtmlEntities(match[2].trim()),
    required: true
  }));
}

function extractLinkReferences(html) {
  return Array.from(html.matchAll(/<link\b[^>]*>/gi), (match) => {
    const tag = match[0];
    const href = getHtmlAttribute(tag, "href");
    if (!href) return undefined;

    const rel = (getHtmlAttribute(tag, "rel") || "").toLowerCase();
    const tracked = rel.split(/\s+/).some((value) => [
      "stylesheet",
      "modulepreload",
      "preload",
      "icon",
      "shortcut",
      "apple-touch-icon"
    ].includes(value));

    if (!tracked) return undefined;

    return {
      kind: "link",
      path: decodeHtmlEntities(href.trim()),
      required: true
    };
  }).filter(Boolean);
}

function getHtmlAttribute(tag, attributeName) {
  const match = tag.match(new RegExp(`\\b${attributeName}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2];
}

function isLocalAssetReference(value) {
  if (!value || value.startsWith("#")) return false;

  return !/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value)
    && !/^(?:data|mailto|tel|javascript):/i.test(value);
}

function isUnbuiltSourceReference(value) {
  const pathname = stripUrlSuffix(value).toLowerCase();

  return /\.(?:[cm]?ts|tsx|jsx)$/.test(pathname) || pathname.includes("/src/");
}

function resolveAssetPath({ siteRoot, indexPath, assetPath }) {
  const cleanPath = stripUrlSuffix(assetPath);
  if (!cleanPath || cleanPath.startsWith("#")) return undefined;

  const root = path.resolve(siteRoot);
  const resolved = cleanPath.startsWith("/")
    ? path.resolve(root, `.${cleanPath}`)
    : path.resolve(path.dirname(indexPath), cleanPath);

  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new HttpError(400, `index.html references an asset outside the static site root: ${assetPath}`);
  }

  return resolved;
}

function stripUrlSuffix(value) {
  return value.split(/[?#]/, 1)[0];
}

async function pathExists(filePath) {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.isFile();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
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

async function createTarArchive(rootDir) {
  const files = await collectFiles(rootDir);
  const chunks = [];

  for (const filePath of files.sort()) {
    const relativePath = toPosixPath(path.relative(rootDir, filePath));
    const stat = await fs.promises.stat(filePath);
    const content = await fs.promises.readFile(filePath);

    chunks.push(createTarHeader(relativePath, stat.size, stat.mode));
    chunks.push(content);
    chunks.push(Buffer.alloc(padLength(stat.size)));
  }

  chunks.push(Buffer.alloc(TAR_BLOCK_SIZE * 2));
  return Buffer.concat(chunks);
}

function createTarHeader(fileName, size, mode) {
  const header = Buffer.alloc(TAR_BLOCK_SIZE, 0);
  const { name, prefix } = splitTarPath(fileName);

  writeString(header, name, 0, 100);
  writeOctal(header, mode & 0o777, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, 0, 136, 12);
  header.fill(" ", 148, 156);
  writeString(header, "0", 156, 1);
  writeString(header, "ustar", 257, 6);
  writeString(header, "00", 263, 2);
  writeString(header, "root", 265, 32);
  writeString(header, "root", 297, 32);
  writeString(header, prefix, 345, 155);

  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeOctal(header, checksum, 148, 8);

  return header;
}

function splitTarPath(fileName) {
  const nameBytes = Buffer.byteLength(fileName);
  if (nameBytes <= 100) {
    return { name: fileName, prefix: "" };
  }

  const parts = fileName.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    const prefix = parts.slice(0, index).join("/");
    const name = parts.slice(index).join("/");

    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
  }

  throw new HttpError(400, `Static site file path is too long for deployment archive: ${fileName}`);
}

function writeString(buffer, value, offset, length) {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), "utf8");
}

function writeOctal(buffer, value, offset, length) {
  const output = value.toString(8).padStart(length - 1, "0").slice(-(length - 1));
  buffer.write(output, offset, length - 1, "ascii");
  buffer[offset + length - 1] = 0;
}

function padLength(size) {
  const remainder = size % TAR_BLOCK_SIZE;
  return remainder === 0 ? 0 : TAR_BLOCK_SIZE - remainder;
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function decodeHtmlEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_match, entity) => {
    const normalized = entity.toLowerCase();
    if (normalized === "amp") return "&";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "quot") return "\"";
    if (normalized === "apos") return "'";

    if (normalized.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
    }

    if (normalized.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10));
    }

    return entity;
  });
}
