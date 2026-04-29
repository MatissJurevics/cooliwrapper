import fs from "node:fs";
import path from "node:path";
import yauzl from "yauzl";
import { HttpError } from "./errors.js";

const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_SYMLINK_TYPE = 0o120000;

export async function extractZip(zipPath, targetDir, limits) {
  await fs.promises.mkdir(targetDir, { recursive: true });

  return new Promise((resolve, reject) => {
    let extractedFiles = 0;
    let extractedBytes = 0;
    const entries = [];
    let zipfileRef;
    let rejected = false;

    function fail(error) {
      if (rejected) return;
      rejected = true;
      if (zipfileRef) zipfileRef.close();
      reject(error);
    }

    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (openError, zipfile) => {
      if (openError) {
        fail(new HttpError(400, "Uploaded file is not a readable ZIP", openError.message));
        return;
      }

      zipfileRef = zipfile;

      zipfile.on("entry", (entry) => {
        extractEntry(zipfile, entry).then(() => {
          if (!rejected) zipfile.readEntry();
        }, fail);
      });

      zipfile.on("end", () => {
        if (!rejected) {
          resolve({
            files: extractedFiles,
            bytes: extractedBytes,
            entries
          });
        }
      });

      zipfile.on("error", fail);
      zipfile.readEntry();
    });

    async function extractEntry(zipfile, entry) {
      const entryName = normalizeZipEntryName(entry.fileName);
      if (!entryName) return;

      if (isSymlink(entry)) {
        throw new HttpError(400, `ZIP entry cannot be a symlink: ${entry.fileName}`);
      }

      const outputPath = resolveSafePath(targetDir, entryName);
      const isDirectory = entryName.endsWith("/");

      if (isDirectory) {
        await fs.promises.mkdir(outputPath, { recursive: true });
        return;
      }

      extractedFiles += 1;
      if (extractedFiles > limits.maxExtractedFiles) {
        throw new HttpError(413, `ZIP contains more than ${limits.maxExtractedFiles} files`);
      }

      await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
      entries.push(entryName);

      await new Promise((resolveEntry, rejectEntry) => {
        zipfile.openReadStream(entry, (streamError, readStream) => {
          if (streamError) {
            rejectEntry(streamError);
            return;
          }

          const writeStream = fs.createWriteStream(outputPath, { flags: "wx" });
          let entryBytes = 0;

          readStream.on("data", (chunk) => {
            entryBytes += chunk.length;
            extractedBytes += chunk.length;

            if (entryBytes > limits.maxExtractedBytes) {
              readStream.destroy(new HttpError(413, `ZIP entry is too large: ${entryName}`));
              return;
            }

            if (extractedBytes > limits.maxExtractedBytes) {
              readStream.destroy(new HttpError(413, `ZIP expands beyond ${limits.maxExtractedBytes} bytes`));
            }
          });

          readStream.on("error", rejectEntry);
          writeStream.on("error", rejectEntry);
          writeStream.on("finish", resolveEntry);
          readStream.pipe(writeStream);
        });
      });
    }
  });
}

function normalizeZipEntryName(fileName) {
  const normalized = fileName.replaceAll("\\", "/");
  if (!normalized || normalized === "." || normalized.includes("\0")) {
    throw new HttpError(400, `Invalid ZIP entry name: ${fileName}`);
  }

  if (normalized.startsWith("/")) {
    throw new HttpError(400, `ZIP entry cannot use an absolute path: ${fileName}`);
  }

  if (/^[a-zA-Z]:\//.test(normalized)) {
    throw new HttpError(400, `ZIP entry cannot use an absolute drive path: ${fileName}`);
  }

  return normalized;
}

function resolveSafePath(rootDir, entryName) {
  const root = path.resolve(rootDir);
  const outputPath = path.resolve(root, entryName);

  if (outputPath !== root && !outputPath.startsWith(`${root}${path.sep}`)) {
    throw new HttpError(400, `ZIP entry escapes extraction directory: ${entryName}`);
  }

  return outputPath;
}

function isSymlink(entry) {
  const mode = (entry.externalFileAttributes >> 16) & UNIX_FILE_TYPE_MASK;
  return mode === UNIX_SYMLINK_TYPE;
}
