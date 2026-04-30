import express from "express";
import { config } from "./config.js";
import { CoolifyClient } from "./coolifyClient.js";
import { HttpError } from "./errors.js";
import { createArtifactsRouter } from "./routes/artifacts.js";
import { createCoolifyRouter } from "./routes/coolify.js";
import { createDeploymentsRouter } from "./routes/deployments.js";
import { createDocsRouter } from "./routes/docs.js";
import { createTspDeploymentsRouter } from "./routes/tspDeployments.js";

const app = express();
const coolifyClient = new CoolifyClient(config.coolify);

app.set("trust proxy", true);
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    coolifyBaseUrl: config.coolify.baseUrl
  });
});

app.get("/coolify/health", async (_request, response, next) => {
  try {
    const result = await coolifyClient.health();
    response.json({ ok: true, result });
  } catch (error) {
    next(error);
  }
});

app.use("/docs", createDocsRouter({ config }));
app.use("/artifacts", createArtifactsRouter({ config }));
app.use(requireWrapperAuth(config.wrapperApiKey));
app.use("/coolify", createCoolifyRouter({ config, coolifyClient }));
app.use("/deployments", createDeploymentsRouter({ config, coolifyClient }));
app.use("/tsp-deployments", createTspDeploymentsRouter({ config, coolifyClient }));

app.use((_request, _response, next) => {
  next(new HttpError(404, "Route not found"));
});

app.use((error, _request, response, _next) => {
  const statusCode = error.statusCode || (error.code === "LIMIT_FILE_SIZE" ? 413 : 500);
  const message = error.code === "LIMIT_FILE_SIZE" ? "ZIP upload is too large" : error.message;

  response.status(statusCode).json({
    error: {
      message,
      details: error.details
    }
  });
});

app.listen(config.port, config.host, () => {
  console.log(`cooliwrapper listening on http://${config.host}:${config.port}`);
});

function requireWrapperAuth(apiKey) {
  return (request, _response, next) => {
    if (!apiKey) {
      next();
      return;
    }

    const bearerToken = (request.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const presented = request.headers["x-api-key"] || bearerToken;

    if (presented !== apiKey) {
      next(new HttpError(401, "Invalid wrapper API key"));
      return;
    }

    next();
  };
}
