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
- a public URL returned by Coolify
- an extracted local copy retained by the wrapper container volume

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

8. The wrapper builds a Dockerfile that:
   - starts from `nginx:alpine`
   - embeds the static site as a compressed archive
   - extracts it into `/usr/share/nginx/html`
   - serves it on port `80`
9. The Dockerfile is base64 encoded.
10. The wrapper calls Coolify's Dockerfile application create endpoint.
11. Coolify creates and deploys a new application resource.

## Authentication

Public health endpoints do not require wrapper auth:

- `GET /health`
- `GET /coolify/health`

Protected endpoints require wrapper auth only when `WRAPPER_API_KEY` is configured:

- `POST /deployments`
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
    "domains": "http://cwwp6dw5h5v8z8jwx23t0rza.159.69.49.174.sslip.io"
  },
  "local": {
    "title": "Cooliwrapper Sample",
    "resourceSlug": "cooliwrapper-sample-b41b7d8c",
    "path": "/app/uploads/static-sites/cooliwrapper-sample-b41b7d8c",
    "indexPath": "/app/uploads/static-sites/cooliwrapper-sample-b41b7d8c/index.html"
  },
  "warnings": [
    "Static HTML was deployed through Coolify's Dockerfile application API because Coolify does not expose a direct static ZIP upload endpoint."
  ]
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
```

Optional environment variables:

```env
WRAPPER_API_KEY=<wrapper-client-token>
STATIC_SITE_DOMAIN_SUFFIX=
STATIC_SITE_DOMAIN_SCHEME=https
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
