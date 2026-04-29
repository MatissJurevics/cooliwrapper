import fs from "node:fs";
import path from "node:path";
import express from "express";
import { HttpError } from "../errors.js";

const ARTIFACT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createArtifactsRouter({ config }) {
  const router = express.Router();

  router.get("/:artifactId/site.tgz", async (request, response, next) => {
    try {
      const { artifactId } = request.params;
      if (!ARTIFACT_ID_PATTERN.test(artifactId)) {
        throw new HttpError(404, "Artifact not found");
      }

      const artifactPath = path.join(config.staticSites.artifactStorageRoot, `${artifactId}.tgz`);
      const metadataPath = path.join(config.staticSites.artifactStorageRoot, `${artifactId}.json`);
      const metadata = await readArtifactMetadata(metadataPath);

      if (!request.query.token || request.query.token !== metadata.token) {
        throw new HttpError(404, "Artifact not found");
      }

      await fs.promises.access(artifactPath, fs.constants.R_OK);

      response.setHeader("Content-Type", "application/gzip");
      response.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      fs.createReadStream(artifactPath).pipe(response);
    } catch (error) {
      if (error.code === "ENOENT") {
        next(new HttpError(404, "Artifact not found"));
        return;
      }

      next(error);
    }
  });

  return router;
}

async function readArtifactMetadata(metadataPath) {
  try {
    return JSON.parse(await fs.promises.readFile(metadataPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new HttpError(404, "Artifact not found");
    }

    throw error;
  }
}
