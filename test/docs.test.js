import assert from "node:assert/strict";
import test from "node:test";
import { buildOpenApiDocument, getDocFile, renderDocsIndex } from "../src/routes/docs.js";

test("renders public docs index with deployment examples", () => {
  const html = renderDocsIndex("https://uigendeploy.mati.ss");

  assert.match(html, /UI Gen Deployment API/);
  assert.match(html, /https:\/\/uigendeploy\.mati\.ss\/deployments/);
  assert.match(html, /https:\/\/uigendeploy\.mati\.ss\/tsp-deployments/);
  assert.match(html, /\/docs\/openapi\.json/);
});

test("builds OpenAPI document for public deployment API", () => {
  const openApi = buildOpenApiDocument("https://uigendeploy.mati.ss");

  assert.equal(openApi.openapi, "3.1.0");
  assert.equal(openApi.servers[0].url, "https://uigendeploy.mati.ss");
  assert.ok(openApi.paths["/deployments"].post);
  assert.ok(openApi.paths["/tsp-deployments"].post);
  assert.ok(openApi.paths["/docs"].get);
  assert.equal(openApi.paths["/deployments"].post.requestBody.content["multipart/form-data"].schema.required[0], "zip");
  assert.equal(openApi.paths["/tsp-deployments"].post.requestBody.content["multipart/form-data"].schema.required[0], "tsp");
});

test("serves only allowlisted markdown docs", () => {
  assert.equal(getDocFile("api.md").title, "Deployment API Spec");
  assert.equal(getDocFile("tsp-deployment-api.md").title, "TSP Deployment API Guide");
  assert.equal(getDocFile("../.env"), undefined);
});
