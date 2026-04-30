import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { HttpError } from "../errors.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const DOC_FILES = {
  "api.md": {
    title: "Deployment API Spec",
    path: path.join(PROJECT_ROOT, "SPEC.md")
  },
  "tsp-deployment-api.md": {
    title: "TSP Deployment API Guide",
    path: path.join(PROJECT_ROOT, "docs/tsp-deployment-api.md")
  },
  "readme.md": {
    title: "Project README",
    path: path.join(PROJECT_ROOT, "README.md")
  }
};

export function createDocsRouter({ config } = {}) {
  const router = express.Router();

  router.get("/", (request, response) => {
    response.type("html").send(renderDocsIndex(getPublicBaseUrl(request, config)));
  });

  router.get("/openapi.json", (request, response) => {
    response.json(buildOpenApiDocument(getPublicBaseUrl(request, config)));
  });

  router.get("/:fileName", async (request, response, next) => {
    try {
      const docFile = getDocFile(request.params.fileName);
      if (!docFile) {
        throw new HttpError(404, "Documentation file not found");
      }

      response.type("text/markdown").send(await fs.readFile(docFile.path, "utf8"));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function getDocFile(fileName) {
  return DOC_FILES[fileName];
}

export function renderDocsIndex(publicBaseUrl = "https://uigendeploy.mati.ss") {
  const baseUrl = escapeHtml(publicBaseUrl);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>UI Gen Deployment API Docs</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f7f7f4;
      --fg: #181816;
      --muted: #5c5b55;
      --line: #d8d6cf;
      --panel: #ffffff;
      --accent: #0f766e;
      --code: #111827;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #121211;
        --fg: #f3f2ec;
        --muted: #b5b1a6;
        --line: #33322e;
        --panel: #1a1a18;
        --accent: #2dd4bf;
        --code: #050505;
      }
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--fg);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
    }

    main {
      width: min(960px, calc(100% - 32px));
      margin: 0 auto;
      padding: 56px 0 72px;
    }

    h1 {
      margin: 0 0 12px;
      font-size: clamp(2rem, 6vw, 4.5rem);
      line-height: 0.95;
      letter-spacing: 0;
    }

    h2 {
      margin: 40px 0 12px;
      font-size: 1.25rem;
      letter-spacing: 0;
    }

    p {
      margin: 0 0 16px;
      max-width: 720px;
      color: var(--muted);
    }

    a {
      color: var(--accent);
      text-decoration-thickness: 1px;
      text-underline-offset: 3px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 12px;
      margin: 20px 0 0;
    }

    .card {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      padding: 18px;
      min-height: 136px;
    }

    .card h3 {
      margin: 0 0 8px;
      font-size: 1rem;
    }

    .card p {
      font-size: 0.94rem;
      margin-bottom: 12px;
    }

    code,
    pre {
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    }

    pre {
      margin: 12px 0 0;
      padding: 16px;
      overflow-x: auto;
      border-radius: 8px;
      background: var(--code);
      color: #f8fafc;
      font-size: 0.9rem;
    }

    .method {
      display: inline-block;
      min-width: 54px;
      margin-right: 8px;
      color: var(--accent);
      font-weight: 700;
    }

    ul {
      padding-left: 20px;
      color: var(--muted);
    }
  </style>
</head>
<body>
  <main>
    <h1>UI Gen Deployment API</h1>
    <p>Public integration docs for deploying generated static sites and TSP Python backends through the wrapper at <code>${baseUrl}</code>.</p>
    <p>Deployment endpoints require the wrapper API key through <code>x-api-key</code> or <code>Authorization: Bearer</code>. This docs page and <code>/health</code> are public.</p>

    <section>
      <h2>Docs</h2>
      <div class="grid">
        <article class="card">
          <h3>Full API Spec</h3>
          <p>Static deployment flow, request fields, response shape, errors, and configuration.</p>
          <a href="/docs/api.md">Open markdown</a>
        </article>
        <article class="card">
          <h3>TSP Backend Guide</h3>
          <p>How generators should upload <code>.tsp</code> archives and interpret deployment responses.</p>
          <a href="/docs/tsp-deployment-api.md">Open markdown</a>
        </article>
        <article class="card">
          <h3>OpenAPI JSON</h3>
          <p>Machine-readable schema for clients, agents, and API tooling.</p>
          <a href="/docs/openapi.json">Open JSON</a>
        </article>
      </div>
    </section>

    <section>
      <h2>Endpoints</h2>
      <ul>
        <li><span class="method">POST</span><code>/deployments</code> uploads a static HTML ZIP.</li>
        <li><span class="method">POST</span><code>/tsp-deployments</code> uploads a generated <code>.tsp</code> backend archive.</li>
        <li><span class="method">GET</span><code>/health</code> checks wrapper availability.</li>
        <li><span class="method">GET</span><code>/docs/openapi.json</code> returns the OpenAPI document.</li>
      </ul>
    </section>

    <section>
      <h2>Static Site Upload</h2>
      <p>Upload already-built browser assets. For Vite/React apps, run <code>npm run build</code> and zip the contents of <code>dist</code>. Do not upload source files where <code>index.html</code> still references <code>/src/main.tsx</code>.</p>
      <pre><code>curl -X POST ${baseUrl}/deployments \\
  -H "x-api-key: $WRAPPER_API_KEY" \\
  -F "zip=@./static-site.zip"</code></pre>
    </section>

    <section>
      <h2>TSP Backend Upload</h2>
      <pre><code>curl -X POST ${baseUrl}/tsp-deployments \\
  -H "x-api-key: $WRAPPER_API_KEY" \\
  -F "tsp=@./backend.tsp"</code></pre>
    </section>
  </main>
</body>
</html>`;
}

export function buildOpenApiDocument(publicBaseUrl = "https://uigendeploy.mati.ss") {
  return {
    openapi: "3.1.0",
    info: {
      title: "UI Gen Deployment API",
      version: "1.0.0",
      description: "Deploy generated static HTML ZIPs and TSP Python backend archives to Coolify."
    },
    servers: [
      {
        url: publicBaseUrl
      }
    ],
    components: {
      securitySchemes: {
        WrapperApiKey: {
          type: "apiKey",
          in: "header",
          name: "x-api-key"
        },
        WrapperBearer: {
          type: "http",
          scheme: "bearer"
        }
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                message: { type: "string" },
                details: {}
              },
              required: ["message"]
            }
          },
          required: ["error"]
        }
      }
    },
    paths: {
      "/health": {
        get: {
          summary: "Check wrapper health",
          responses: {
            200: {
              description: "Wrapper is running"
            }
          }
        }
      },
      "/docs": {
        get: {
          summary: "Open browser-friendly integration docs",
          responses: {
            200: {
              description: "HTML documentation page",
              content: {
                "text/html": {}
              }
            }
          }
        }
      },
      "/docs/openapi.json": {
        get: {
          summary: "Get this OpenAPI document",
          responses: {
            200: {
              description: "OpenAPI schema"
            }
          }
        }
      },
      "/docs/api.md": {
        get: {
          summary: "Get the full deployment API markdown spec",
          responses: {
            200: {
              description: "Markdown documentation",
              content: {
                "text/markdown": {}
              }
            }
          }
        }
      },
      "/docs/tsp-deployment-api.md": {
        get: {
          summary: "Get the TSP deployment markdown guide",
          responses: {
            200: {
              description: "Markdown documentation",
              content: {
                "text/markdown": {}
              }
            }
          }
        }
      },
      "/deployments": {
        post: {
          summary: "Deploy a static HTML ZIP",
          security: [{ WrapperApiKey: [] }, { WrapperBearer: [] }],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    zip: {
                      type: "string",
                      format: "binary",
                      description: "Required .zip archive containing already-built static browser assets and index.html."
                    },
                    manifest: {
                      type: "string",
                      description: "Optional JSON string that overrides coolify.json."
                    }
                  },
                  required: ["zip"]
                }
              }
            }
          },
          responses: {
            202: {
              description: "Deployment accepted and Coolify resource created or updated"
            },
            default: {
              description: "Error",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse"
                  }
                }
              }
            }
          }
        }
      },
      "/tsp-deployments": {
        post: {
          summary: "Deploy a TSP Python backend archive",
          security: [{ WrapperApiKey: [] }, { WrapperBearer: [] }],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    tsp: {
                      type: "string",
                      format: "binary",
                      description: "Required .tsp or .zip archive generated by Tinsel."
                    },
                    manifest: {
                      type: "string",
                      description: "Optional JSON string with Coolify overrides."
                    }
                  },
                  required: ["tsp"]
                }
              }
            }
          },
          responses: {
            202: {
              description: "Deployment accepted and Coolify Dockerfile application created"
            },
            default: {
              description: "Error",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse"
                  }
                }
              }
            }
          }
        }
      }
    }
  };
}

function getPublicBaseUrl(request, config = {}) {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  if (request) return `${request.protocol}://${request.get("host")}`;
  return "https://uigendeploy.mati.ss";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
