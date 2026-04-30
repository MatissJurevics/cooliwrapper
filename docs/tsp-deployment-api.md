# TSP Deployment API Integration

Use this document from any app that generates `.tsp` archives and needs to deploy the generated Python backend through the Ui Gen Deployment API.

## Endpoint

```text
POST https://uigendeploy.mati.ss/tsp-deployments
```

The request must be `multipart/form-data`.

Fields:

- `tsp`: required `.tsp` file. A `.tsp` is treated as a ZIP archive.
- `manifest`: optional JSON string with deployment overrides.

Headers:

```http
x-api-key: <WRAPPER_API_KEY>
```

You can also use:

```http
Authorization: Bearer <WRAPPER_API_KEY>
```

## TSP Archive Contract

The archive must contain these paths at the archive root:

```text
manifest.json
services/api/requirements.txt
services/api/pyproject.toml
services/api/app/__init__.py
services/api/app/__main__.py
services/api/app/main.py
services/api/app/app.py
```

`services/api/Dockerfile` may also be present. The deployment API generates an equivalent Coolify Dockerfile around the tokenized artifact URL so Coolify does not need the original archive as build context.

Optional generated database package:

```text
services/api/databases/todo_db
```

Important generator requirements:

- Do not wrap the archive contents in an extra top-level folder.
- `manifest.json` must be valid JSON.
- `manifest.json.name` should be the generated app name, for example `TodoApp`.
- `services/api/pyproject.toml` must support Python 3.12. Current Tinsel output uses `requires-python = ">=3.12"`.
- The backend must be runnable from `services/api` with `python -m app`.
- The backend should listen on `0.0.0.0:8080` by default, or on the `port` value sent in the optional request manifest.
- The backend should expose `GET /health` by default, or the `health_check_path` value sent in the optional request manifest.

Legacy archives that use `repository/services/api` are still accepted as a fallback, but new Tinsel generators should emit the `services/api` layout above.

## Default Deployment Behavior

For a TSP with:

```json
{
  "name": "TodoApp"
}
```

the deployment API creates a Coolify Dockerfile application named like:

```text
todoapp-api-<upload-prefix>
```

and assigns a public domain like:

```text
http://todoapp-api-<upload-prefix>.mati.ss:8080
```

The upload prefix is derived from the generated upload ID, so every deployment gets a unique resource name and domain.

## Optional Request Manifest

Send `manifest` when the generator app needs to override defaults:

```json
{
  "name": "TodoApp",
  "description": "Generated TodoApp API",
  "port": 8080,
  "health_check_path": "/health",
  "instant_deploy": true,
  "coolify": {
    "domains": "http://todo-api.mati.ss:8080"
  }
}
```

Common fields:

- `name`: overrides `manifest.json.name` for resource naming.
- `description`: Coolify resource description.
- `port`: exposed backend port. Defaults to `8080`.
- `health_check_path`: Coolify health check path. Defaults to `/health`.
- `instant_deploy`: starts deployment immediately. Defaults to `true`.
- `coolify.domains`: explicit public domain. If omitted, the API generates `http://<resource-slug>.mati.ss:8080`.

Coolify project/server/destination defaults are configured server-side, so normal generator clients should not send those values.

## cURL Example

```bash
curl -X POST https://uigendeploy.mati.ss/tsp-deployments \
  -H "x-api-key: $WRAPPER_API_KEY" \
  -F "tsp=@./TodoApp.tsp"
```

With a request manifest:

```bash
curl -X POST https://uigendeploy.mati.ss/tsp-deployments \
  -H "x-api-key: $WRAPPER_API_KEY" \
  -F "tsp=@./TodoApp.tsp" \
  -F 'manifest={"name":"TodoApp","port":8080,"health_check_path":"/health"}'
```

## TypeScript Client Example

This example uses the built-in `fetch`, `FormData`, and `Blob` APIs available in modern Node runtimes.

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";

type DeployTspResponse = {
  id: string;
  action: string;
  extracted: {
    files: number;
    bytes: number;
  };
  coolify: {
    uuid?: string;
    domains?: string;
    [key: string]: unknown;
  };
  local: {
    projectName: string;
    servicePath: "services/api" | "repository/services/api";
    layout: "tinsel" | "legacy";
    resourceSlug: string;
    artifactBytes: number;
    artifactUrl: string;
    port: string;
  };
  warnings?: string[];
};

export async function deployTsp({
  apiKey,
  tspPath,
  manifest
}: {
  apiKey: string;
  tspPath: string;
  manifest?: Record<string, unknown>;
}): Promise<DeployTspResponse> {
  const form = new FormData();
  const bytes = await readFile(tspPath);
  const filename = path.basename(tspPath);

  form.append("tsp", new Blob([new Uint8Array(bytes)], { type: "application/zip" }), filename);

  if (manifest) {
    form.append("manifest", JSON.stringify(manifest));
  }

  const response = await fetch("https://uigendeploy.mati.ss/tsp-deployments", {
    method: "POST",
    headers: {
      "x-api-key": apiKey
    },
    body: form
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error?.message || `TSP deployment failed with HTTP ${response.status}`);
  }

  return payload as DeployTspResponse;
}
```

## Success Response

Successful requests return `202 Accepted`.

```json
{
  "id": "12345678-aaaa-bbbb-cccc-123456789abc",
  "action": "application.dockerfile.created",
  "extracted": {
    "files": 105,
    "bytes": 657214
  },
  "coolify": {
    "uuid": "coolify-resource-uuid",
    "domains": "http://todoapp-api-12345678.mati.ss:8080"
  },
  "local": {
    "projectName": "TodoApp",
    "servicePath": "services/api",
    "layout": "tinsel",
    "resourceSlug": "todoapp-api-12345678",
    "path": "/app/uploads/static-sites/tsp-backends/todoapp-api-12345678",
    "artifactPath": "/app/uploads/artifacts/12345678-aaaa-bbbb-cccc-123456789abc.tgz",
    "artifactBytes": 120000,
    "artifactUrl": "https://uigendeploy.mati.ss/artifacts/12345678-aaaa-bbbb-cccc-123456789abc/site.tgz?token=<artifact-token>",
    "port": "8080"
  },
  "warnings": [
    "TSP Python backend was deployed through Coolify's Dockerfile application API. The generated Dockerfile downloads a tokenized TSP artifact from this wrapper during the Coolify build.",
    "The generated backend uses SQLite by default. Unless the generated backend is changed to use an external database, data persistence across rebuilds is not guaranteed."
  ]
}
```

Client apps should treat `coolify.domains` as the public backend URL when present.

`202 Accepted` means the wrapper created the Coolify resource and requested an instant deploy. The backend can still take time to build and become healthy in Coolify.

## Error Handling

Errors return JSON:

```json
{
  "error": {
    "message": "Human readable message",
    "details": {}
  }
}
```

Common failures:

- `400`: missing `tsp` file field.
- `400`: upload is not `.tsp` or `.zip`.
- `400`: missing `manifest.json`.
- `400`: invalid `manifest.json`.
- `400`: missing required backend files under `services/api`.
- `400`: invalid optional request `manifest` JSON.
- `401`: invalid or missing wrapper API key when auth is enabled.
- `413`: archive or extracted content exceeds configured limits.
- `500`: deployment API is missing server-side Coolify configuration.

## Runtime Notes

The deployment API generates a Dockerfile that:

1. Uses `ghcr.io/astral-sh/uv:python3.12-bookworm-slim`.
2. Downloads a tokenized artifact from the deployment API.
3. Installs `curl` so Coolify's Dockerfile healthcheck can probe `/health`.
4. Uses `services/api` as the build working directory.
5. Installs the generated API package with `uv pip install --system .`.
6. Uses the generated package metadata instead of special-casing `requirements.txt`.
7. Starts the backend with `python -m app`.

The deployment wrapper creates TSP applications with immediate deploy disabled, patches the Coolify exposed port and generated proxy labels to the backend port, then triggers deployment when `instant_deploy` is true. This keeps Coolify's public proxy aligned with the FastAPI port.

Generated SQLite databases are not durable by default. For production persistence, generate the backend to use an external database or add persistent storage support.
