import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { HttpError } from "./errors.js";

const TAR_BLOCK_SIZE = 512;
const DOCKERFILE_BASE64_LINE_LENGTH = 120;
const DOCKERFILE_LINES_PER_RUN = 100;

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

  const titleSlug = slugify(title);
  const shortId = uploadId.replaceAll("-", "").slice(0, 8);
  const resourceSlug = `${titleSlug}-${shortId}`;
  const siteRoot = path.dirname(indexPath);
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
    indexPath: path.join(localPath, "index.html")
  };
}

export async function buildStaticSiteDockerfile(siteRoot, { maxArchiveBytes }) {
  const archive = gzipSync(await createTarArchive(siteRoot));

  if (archive.length > maxArchiveBytes) {
    throw new HttpError(
      413,
      `Static site archive is ${archive.length} bytes, above MAX_STATIC_ARCHIVE_BYTES=${maxArchiveBytes}. Use a Git or Docker registry workflow for larger sites.`
    );
  }

  const base64 = archive.toString("base64");
  const base64Lines = chunkString(base64, DOCKERFILE_BASE64_LINE_LENGTH);

  return [
    "FROM nginx:alpine",
    "RUN rm -rf /usr/share/nginx/html/* && : > /tmp/site.tgz.b64",
    ...buildAppendRuns(base64Lines),
    "RUN base64 -d /tmp/site.tgz.b64 | tar -xz -C /usr/share/nginx/html && rm /tmp/site.tgz.b64",
    ""
  ].join("\n");
}

export function buildStaticSiteDomain(resourceSlug, { domainSuffix, domainScheme }) {
  if (!domainSuffix) return undefined;

  const suffix = domainSuffix.replace(/^\.+/, "").replace(/\.+$/, "");
  return `${domainScheme}://${resourceSlug}.${suffix}`;
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

function buildAppendRuns(lines) {
  const runs = [];

  for (let index = 0; index < lines.length; index += DOCKERFILE_LINES_PER_RUN) {
    const batch = lines.slice(index, index + DOCKERFILE_LINES_PER_RUN);
    const quotedLines = batch.map((line) => `'${line}'`).join(" ");
    runs.push(`RUN printf '%s\\n' ${quotedLines} >> /tmp/site.tgz.b64`);
  }

  return runs;
}

function chunkString(value, size) {
  const chunks = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks;
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
