# TSP Deployment API Integration

Use this document from any app that generates `.tsp` archives and needs to deploy the generated Python backend through the Ui Gen Deployment API.

## Endpoint

```text
POST https://uigendeploy.deploymentsv1.dubsof.com/tsp-deployments
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
repository/services/api/requirements.txt
repository/services/api/__init__.py
repository/services/api/main.py
repository/services/api/app.py
```

Optional generated database package:

```text
repository/databases/todo_db
```

Important generator requirements:

- Do not wrap the archive contents in an extra top-level folder.
- `manifest.json` must be valid JSON.
- `manifest.json.name` should be the generated app name, for example `TodoApp`.
- The backend must be runnable with `python -m api.main`.
- The backend should listen on `0.0.0.0:8080` by default, or on the `port` value sent in the optional request manifest.
- The backend should expose `GET /health` by default, or the `health_check_path` value sent in the optional request manifest.

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
https://todoapp-api-<upload-prefix>.deploymentsv1.dubsof.com
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
    "domains": "https://todo-api.deploymentsv1.dubsof.com"
  }
}
```

Common fields:

- `name`: overrides `manifest.json.name` for resource naming.
- `description`: Coolify resource description.
- `port`: exposed backend port. Defaults to `8080`.
- `health_check_path`: Coolify health check path. Defaults to `/health`.
- `instant_deploy`: starts deployment immediately. Defaults to `true`.
- `coolify.domains`: explicit public domain. If omitted, the API generates `https://<resource-slug>.deploymentsv1.dubsof.com`.

Coolify project/server/destination defaults are configured server-side, so normal generator clients should not send those values.

## cURL Example

```bash
curl -X POST https://uigendeploy.deploymentsv1.dubsof.com/tsp-deployments \
  -H "x-api-key: $WRAPPER_API_KEY" \
  -F "tsp=@./TodoApp.tsp"
```

With a request manifest:

```bash
curl -X POST https://uigendeploy.deploymentsv1.dubsof.com/tsp-deployments \
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
    servicePath: "repository/services/api";
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

  const response = await fetch("https://uigendeploy.deploymentsv1.dubsof.com/tsp-deployments", {
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
    "domains": "https://todoapp-api-12345678.deploymentsv1.dubsof.com"
  },
  "local": {
    "projectName": "TodoApp",
    "servicePath": "repository/services/api",
    "resourceSlug": "todoapp-api-12345678",
    "path": "/app/uploads/static-sites/tsp-backends/todoapp-api-12345678",
    "artifactPath": "/app/uploads/artifacts/12345678-aaaa-bbbb-cccc-123456789abc.tgz",
    "artifactBytes": 120000,
    "artifactUrl": "https://uigendeploy.deploymentsv1.dubsof.com/artifacts/12345678-aaaa-bbbb-cccc-123456789abc/site.tgz?token=<artifact-token>",
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
- `400`: missing required backend files under `repository/services/api`.
- `400`: invalid optional request `manifest` JSON.
- `401`: invalid or missing wrapper API key when auth is enabled.
- `413`: archive or extracted content exceeds configured limits.
- `500`: deployment API is missing server-side Coolify configuration.

## Runtime Notes

The deployment API generates a Dockerfile that:

1. Uses `python:3.11-slim`.
2. Downloads a tokenized artifact from the deployment API.
3. Copies `repository/services/api` into `/app/api`.
4. Installs `repository/databases/todo_db` when present.
5. Installs `requirements.txt`, excluding the generated `../databases/todo_db` line.
6. Starts the backend with `python -m api.main`.

Generated SQLite databases are not durable by default. For production persistence, generate the backend to use an external database or add persistent storage support.
