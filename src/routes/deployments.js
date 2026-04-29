import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { extractZip } from "../extractZip.js";
import { buildDeploymentPlan, executeDeploymentPlan } from "../manifest.js";
import { HttpError } from "../errors.js";

export function createDeploymentsRouter({ config, coolifyClient }) {
  const router = express.Router();
  const upload = multer({
    dest: os.tmpdir(),
    limits: {
      fileSize: config.uploads.maxZipBytes,
      files: 1
    },
    fileFilter(_request, file, callback) {
      if (file.originalname.toLowerCase().endsWith(".zip")) {
        callback(null, true);
        return;
      }

      callback(new HttpError(400, "Upload must be a .zip file"));
    }
  });

  router.post("/", upload.single("zip"), async (request, response, next) => {
    const uploadId = randomUUID();
    const uploadFile = request.file;
    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `cooliwrapper-${uploadId}-`));
    const extractDir = path.join(workDir, "extract");

    try {
      if (!uploadFile) {
        throw new HttpError(400, "Multipart field 'zip' is required");
      }

      const requestManifest = parseRequestManifest(request.body);
      const extraction = await extractZip(uploadFile.path, extractDir, config.uploads);
      const plan = await buildDeploymentPlan({
        extractDir,
        requestManifest,
        defaults: config.coolify.defaults,
        staticSites: config.staticSites,
        uploadId
      });
      const coolify = await executeDeploymentPlan(plan, coolifyClient);

      response.status(202).json({
        id: uploadId,
        action: coolify.action,
        extracted: {
          files: extraction.files,
          bytes: extraction.bytes
        },
        coolify: coolify.result,
        local: coolify.local,
        warnings: coolify.warnings
      });
    } catch (error) {
      next(error);
    } finally {
      await cleanupUpload({ uploadFile, workDir, keepUploads: config.uploads.keepUploads });
    }
  });

  return router;
}

function parseRequestManifest(body) {
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

async function cleanupUpload({ uploadFile, workDir, keepUploads }) {
  if (keepUploads) return;

  await Promise.allSettled([
    uploadFile?.path ? fs.promises.rm(uploadFile.path, { force: true }) : undefined,
    fs.promises.rm(workDir, { recursive: true, force: true })
  ]);
}
