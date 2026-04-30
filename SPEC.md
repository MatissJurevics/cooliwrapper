# Ui Gen Deployment API Spec

Public base URL:

```text
https://uigendeploy.mati.ss
```

This service accepts ZIP uploads containing static HTML, stores the extracted files, and creates a new Coolify resource on `coolify.mati.ss`.

## Purpose

The API is a deployment bridge for generated static UI output.

Input:

- a `.zip` file
- an `index.html` file inside the ZIP
- a non-empty `<title>` tag inside `index.html`

Output:

- a new Coolify Dockerfile application
- a generated resource name based on the HTML title
- a public URL matching `https://<resource-slug>.mati.ss`
- an extracted local copy retained by the wrapper container volume
- a tokenized build artifact retained by the wrapper container volume

The API also supports generated TSP Python backend archives through `POST /tsp-deployments`.

## Runtime Behavior

1. Client uploads a ZIP to `POST /deployments`.
2. The wrapper extracts the ZIP into a temporary directory.
3. Extraction rejects unsafe ZIPs:
   - path traversal entries
   - absolute paths
   - symlinks
   - more than `MAX_EXTRACTED_FILES`
   - more than `MAX_EXTRACTED_BYTES`
4. The wrapper finds the shallowest `index.html`.
5. The wrapper reads the page `<title>`.
6. The title is slugified and combined with the upload ID prefix:

```text
<title-slug>-<8-char-upload-prefix>
```

Example:

```text
Cooliwrapper Sample -> cooliwrapper-sample-b41b7d8c
```

7. The extracted static site is copied to:

```text
/app/uploads/static-sites/<resource-slug>
```

8. The wrapper creates a compressed artifact at:

```text
/app/uploads/artifacts/<upload-id>.tgz
```

9. The wrapper creates a random artifact token and exposes the archive at:

```text
https://uigendeploy.mati.ss/artifacts/<upload-id>/site.tgz?token=<artifact-token>
```

10. The wrapper builds a small Dockerfile that:
   - starts from `nginx:alpine`
   - downloads the tokenized artifact URL with Dockerfile `ADD`
   - extracts it into `/usr/share/nginx/html`
   - serves it on port `80`
11. The Dockerfile is base64 encoded.
12. The wrapper calls Coolify's Dockerfile application create endpoint.
13. Coolify creates and deploys a new application resource with the generated domain:

```text
https://<resource-slug>.mati.ss
```

The artifact-download design avoids passing the full static site through Coolify's command line. This prevents OS-level `Argument list too long` failures during Coolify deployment.

## Authentication

Public health endpoints do not require wrapper auth:

- `GET /health`
- `GET /coolify/health`

Artifact downloads do not use `WRAPPER_API_KEY`, because Coolify's build container needs to fetch them directly. They are protected by a random per-upload token in the artifact URL:

- `GET /artifacts/:artifactId/site.tgz?token=<artifact-token>`

Protected endpoints require wrapper auth only when `WRAPPER_API_KEY` is configured:

- `POST /deployments`
- `POST /tsp-deployments`
- `GET /coolify/discovery`

Production requirement:

```text
WRAPPER_API_KEY must be configured on https://uigendeploy.mati.ss.
```

Without it, anyone who can reach the public URL can create deployments, and `/coolify/discovery` may expose sensitive Coolify resource metadata.

When enabled, provide either:

```http
x-api-key: <WRAPPER_API_KEY>
```

or:

```http
Authorization: Bearer <WRAPPER_API_KEY>
```

The Coolify API token is server-side only and must be configured as `COOLIFY_TOKEN`. Clients must not send the Coolify token to this wrapper.

## Endpoints

### `GET /health`

Returns wrapper process status and configured Coolify API base URL.

Request:

```bash
curl https://uigendeploy.mati.ss/health
```

Response:

```json
{
  "ok": true,
  "coolifyBaseUrl": "https://coolify.mati.ss/api/v1"
}
```

### `GET /coolify/health`

Checks Coolify API reachability.

Request:

```bash
curl https://uigendeploy.mati.ss/coolify/health
```

Response shape:

```json
{
  "ok": true,
  "result": {}
}
```

### `GET /coolify/discovery`

Lists Coolify projects, servers, resources, and environments visible to the configured `COOLIFY_TOKEN`.

This is mainly an operator endpoint for finding:

- `COOLIFY_PROJECT_UUID`
- `COOLIFY_SERVER_UUID`
- `COOLIFY_ENVIRONMENT_NAME`
- `COOLIFY_DESTINATION_UUID`

Request:

```bash
curl https://uigendeploy.mati.ss/coolify/discovery \
  -H "x-api-key: <WRAPPER_API_KEY>"
```

Response shape:

```json
{
  "defaults": {
    "project_uuid": "qdf4nk7vd60795o6cq7vrski",
    "server_uuid": "ekcsokoco8c8co4wk8sgcwc0",
    "environment_name": "production",
    "destination_uuid": "dcg4ws4oc00wc8404wk84kgo"
  },
  "projects": [],
  "servers": [],
  "environments": [],
  "resources": [],
  "selectedServer": {},
  "notes": []
}
```

### `POST /deployments`

Uploads a static HTML ZIP and creates a new Coolify resource.

Content type:

```text
multipart/form-data
```

Fields:

- `zip`: required `.zip` file
- `manifest`: optional JSON string

Request:

```bash
curl -X POST https://uigendeploy.mati.ss/deployments \
  -H "x-api-key: <WRAPPER_API_KEY>" \
  -F "zip=@./static-site.zip"
```

Success status:

```text
202 Accepted
```

Success response:

```json
{
  "id": "b41b7d8c-0c13-4af5-8d48-747ce8b4c567",
  "action": "application.dockerfile.created",
  "extracted": {
    "files": 2,
    "bytes": 1054
  },
  "coolify": {
    "uuid": "cwwp6dw5h5v8z8jwx23t0rza",
    "domains": "https://cooliwrapper-sample-b41b7d8c.mati.ss"
  },
  "local": {
    "title": "Cooliwrapper Sample",
    "resourceSlug": "cooliwrapper-sample-b41b7d8c",
    "path": "/app/uploads/static-sites/cooliwrapper-sample-b41b7d8c",
    "indexPath": "/app/uploads/static-sites/cooliwrapper-sample-b41b7d8c/index.html",
    "artifactPath": "/app/uploads/artifacts/b41b7d8c-0c13-4af5-8d48-747ce8b4c567.tgz",
    "artifactBytes": 723,
    "artifactUrl": "https://uigendeploy.mati.ss/artifacts/b41b7d8c-0c13-4af5-8d48-747ce8b4c567/site.tgz?token=<artifact-token>"
  },
  "warnings": [
    "Static HTML was deployed through Coolify's Dockerfile application API. The generated Dockerfile downloads a tokenized static-site artifact from this wrapper during the Coolify build."
  ]
}
```

### `GET /artifacts/:artifactId/site.tgz`

Downloads a static-site build artifact. This endpoint is primarily for Coolify build containers, not end users.

Query parameters:

- `token`: required artifact token generated during upload

Request:

```bash
curl "https://uigendeploy.mati.ss/artifacts/<artifact-id>/site.tgz?token=<artifact-token>" \
  -o site.tgz
```

Response:

```text
application/gzip
```

Invalid IDs or tokens return `404`.

### `POST /tsp-deployments`

Uploads a `.tsp` archive and creates a new Coolify Dockerfile application for the generated Python backend.

This endpoint expects the current Tinsel TSP archive to be a ZIP with:

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

If present, the generated database package at this path is included in the API package build:

```text
services/api/databases/todo_db
```

Legacy archives using `repository/services/api` and `repository/databases/todo_db` are also accepted as a fallback.

Content type:

```text
multipart/form-data
```

Fields:

- `tsp`: required `.tsp` or `.zip` file
- `manifest`: optional JSON string

Request:

```bash
curl -X POST https://uigendeploy.mati.ss/tsp-deployments \
  -H "x-api-key: <WRAPPER_API_KEY>" \
  -F "tsp=@./backend.tsp"
```

Success status:

```text
202 Accepted
```

Success response shape:

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

Generated Dockerfile behavior:

1. Uses `ghcr.io/astral-sh/uv:python3.12-bookworm-slim`.
2. Downloads the tokenized artifact URL with Dockerfile `ADD`.
3. Installs `curl` so Coolify's Dockerfile healthcheck can probe `/health`.
4. Extracts the TSP repository.
5. Uses `services/api` as the working directory.
6. Installs the generated API package with `uv pip install --system .`.
7. Uses the generated package metadata instead of special-casing `requirements.txt`.
8. Exposes port `8080`.
9. Starts `python -m app`.

The wrapper creates TSP applications with immediate deploy disabled, patches the Coolify exposed port and generated proxy labels to the backend port, then triggers deployment when `instant_deploy` is true. This keeps Coolify's public proxy aligned with the FastAPI port.

Optional manifest override:

```json
{
  "name": "TodoApp",
  "port": 8080,
  "health_check_path": "/health",
  "coolify": {
    "project_uuid": "project-uuid",
    "server_uuid": "server-uuid",
    "environment_name": "production",
    "destination_uuid": "destination-uuid",
    "domains": "http://todo-api.mati.ss:8080"
  }
}
```

## ZIP Requirements

The uploaded ZIP must contain:

```text
index.html
```

The file can be at the root or inside a single top-level folder. If multiple `index.html` files exist, the shallowest one wins.

`index.html` must contain:

```html
<title>Some Site Name</title>
```

The title is required because it determines the Coolify resource name.

## Optional Manifest

Static HTML uploads do not require a manifest when server defaults are configured.

Use `manifest` only to override deployment details.

Example:

```bash
curl -X POST https://uigendeploy.mati.ss/deployments \
  -H "x-api-key: <WRAPPER_API_KEY>" \
  -F "zip=@./static-site.zip" \
  -F 'manifest={"type":"static-html","coolify":{"domains":"https://example.mati.ss"}}'
```

Manifest shape:

```json
{
  "type": "static-html",
  "description": "Optional description",
  "coolify": {
    "project_uuid": "project-uuid",
    "server_uuid": "server-uuid",
    "environment_name": "production",
    "destination_uuid": "destination-uuid",
    "domains": "https://example.mati.ss"
  }
}
```

## Error Format

All errors return:

```json
{
  "error": {
    "message": "Human readable message",
    "details": {}
  }
}
```

Common errors:

- `400`: missing `zip` field
- `400`: upload is not a `.zip`
- `400`: `index.html` missing
- `400`: `<title>` missing or empty
- `400`: invalid manifest JSON
- `401`: invalid wrapper API key
- `413`: ZIP or extracted content exceeds configured limits
- `500`: missing server-side Coolify token
- Coolify API errors are proxied with the Coolify status code and validation details

## Deployment Configuration

Required environment variables:

```env
COOLIFY_BASE_URL=https://coolify.mati.ss
COOLIFY_TOKEN=<coolify-api-token>
COOLIFY_PROJECT_UUID=<target-project-uuid>
COOLIFY_SERVER_UUID=<target-server-uuid>
COOLIFY_ENVIRONMENT_NAME=production
COOLIFY_DESTINATION_UUID=<target-destination-uuid>
PUBLIC_BASE_URL=https://uigendeploy.mati.ss
```

Optional environment variables:

```env
WRAPPER_API_KEY=<wrapper-client-token>
STATIC_SITE_DOMAIN_SUFFIX=mati.ss
STATIC_SITE_DOMAIN_SCHEME=https
STATIC_SITE_ARTIFACT_STORAGE_ROOT=/app/uploads/artifacts
MAX_ZIP_BYTES=104857600
MAX_EXTRACTED_BYTES=524288000
MAX_EXTRACTED_FILES=5000
MAX_STATIC_ARCHIVE_BYTES=26214400
```

## Coolify Deployment Notes

`docker-compose.yml` is the Coolify deployment file.

It intentionally does not publish host port `3000`:

```yaml
expose:
  - "3000"
```

Coolify should route `https://uigendeploy.mati.ss` to the container's internal port `3000`.

For local development, use the local override:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build -d
```

The local override publishes:

```yaml
ports:
  - "3000:3000"
```

Do not use `docker-compose.local.yml` in Coolify.
