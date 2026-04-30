import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { extractZip } from "../extractZip.js";
import { executeDeploymentPlan } from "../manifest.js";
import { buildTspBackendPlan } from "../tspBackend.js";
import { HttpError } from "../errors.js";
import { parseRequestManifest } from "../requestManifest.js";

export function createTspDeploymentsRouter({ config, coolifyClient }) {
  const router = express.Router();
  const upload = multer({
    dest: os.tmpdir(),
    limits: {
      fileSize: config.uploads.maxZipBytes,
      files: 1
    },
    fileFilter(_request, file, callback) {
      const filename = file.originalname.toLowerCase();
      if (filename.endsWith(".tsp") || filename.endsWith(".zip")) {
        callback(null, true);
        return;
      }

      callback(new HttpError(400, "Upload must be a .tsp or .zip file"));
    }
  });

  router.post("/", upload.any(), async (request, response, next) => {
    const uploadId = randomUUID();
    const uploadFile = request.files?.[0];
    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `cooliwrapper-tsp-${uploadId}-`));
    const extractDir = path.join(workDir, "extract");

    try {
      if (!uploadFile) {
        throw new HttpError(400, "Multipart field 'tsp' is required");
      }

      const requestManifest = parseRequestManifest(request.body);
      const extraction = await extractZip(uploadFile.path, extractDir, config.uploads);
      const plan = await buildTspBackendPlan({
        extractDir,
        requestManifest,
        defaults: config.coolify.defaults,
        staticSites: config.staticSites,
        uploadId,
        publicBaseUrl: config.publicBaseUrl || getRequestBaseUrl(request)
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

function getRequestBaseUrl(request) {
  return `${request.protocol}://${request.get("host")}`;
}

async function cleanupUpload({ uploadFile, workDir, keepUploads }) {
  if (keepUploads) return;

  await Promise.allSettled([
    uploadFile?.path ? fs.promises.rm(uploadFile.path, { force: true }) : undefined,
    fs.promises.rm(workDir, { recursive: true, force: true })
  ]);
}
