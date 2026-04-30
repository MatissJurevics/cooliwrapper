import assert from "node:assert/strict";
import test from "node:test";
import { CoolifyClient } from "../src/coolifyClient.js";

test("Coolify API errors include response body and sanitized request details", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url.toString(), "https://coolify.test/api/v1/services");
      assert.equal(init.method, "POST");
      assert.equal(init.headers.Authorization, "Bearer token");

      return new Response(
        JSON.stringify({ message: "The name field is required.", errors: { name: ["required"] } }),
        {
          status: 422,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    };

    const client = new CoolifyClient({ baseUrl: "https://coolify.test/api/v1", token: "token" });

    await assert.rejects(
      client.createService({
        name: "site",
        docker_compose_raw: "services:\n  web:\n    image: nginx:alpine\n",
        dockerfile: "FROM nginx:alpine"
      }),
      (error) => {
        assert.equal(error.statusCode, 422);
        assert.match(error.message, /POST \/services \(422: The name field is required\.\)/);
        assert.deepEqual(error.details.response, {
          message: "The name field is required.",
          errors: {
            name: ["required"]
          }
        });
        assert.equal(error.details.request.body.name, "site");
        assert.match(error.details.request.body.docker_compose_raw, /nginx:alpine/);
        assert.equal(error.details.request.body.dockerfile, "[redacted 17 chars]");
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
