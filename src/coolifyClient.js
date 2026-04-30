import { CoolifyApiError, HttpError } from "./errors.js";

const APPLICATION_ENDPOINTS = {
  public: "/applications/public",
  "private-github-app": "/applications/private-github-app",
  "private-deploy-key": "/applications/private-deploy-key",
  dockerfile: "/applications/dockerfile",
  dockerimage: "/applications/dockerimage",
  dockercompose: "/applications/dockercompose"
};

export class CoolifyClient {
  constructor({ baseUrl, token }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  async request(method, path, { query, body, auth = true } = {}) {
    if (auth && !this.token) {
      throw new HttpError(500, "COOLIFY_TOKEN is required for this operation");
    }

    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const headers = {
      Accept: "application/json"
    };

    if (auth) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const init = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);
    const payload = await parseResponse(response);

    if (!response.ok) {
      throw new CoolifyApiError(response.status, method, path, payload);
    }

    return payload;
  }

  health() {
    return this.request("GET", "/health", { auth: false });
  }

  listProjects() {
    return this.request("GET", "/projects");
  }

  listServers() {
    return this.request("GET", "/servers");
  }

  listResources() {
    return this.request("GET", "/resources");
  }

  getApplication(uuid) {
    return this.request("GET", `/applications/${encodeURIComponent(uuid)}`);
  }

  listProjectEnvironments(projectUuid) {
    return this.request("GET", `/projects/${encodeURIComponent(projectUuid)}/environments`);
  }

  getServer(serverUuid) {
    return this.request("GET", `/servers/${encodeURIComponent(serverUuid)}`);
  }

  createService(body) {
    return this.request("POST", "/services", { body });
  }

  updateService(uuid, body) {
    return this.request("PATCH", `/services/${encodeURIComponent(uuid)}`, { body });
  }

  createApplication(mode, body) {
    const endpoint = APPLICATION_ENDPOINTS[mode];
    if (!endpoint) {
      throw new HttpError(400, `Unsupported application mode: ${mode}`);
    }

    return this.request("POST", endpoint, { body });
  }

  updateApplication(uuid, body) {
    return this.request("PATCH", `/applications/${encodeURIComponent(uuid)}`, { body });
  }

  deploy({ uuid, tag, force, pr }) {
    if (!uuid && !tag) {
      throw new HttpError(400, "Deploy requires uuid or tag");
    }

    return this.request("POST", "/deploy", {
      body: {
        uuid,
        tag,
        force,
        pr
      }
    });
  }
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return JSON.parse(text);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
