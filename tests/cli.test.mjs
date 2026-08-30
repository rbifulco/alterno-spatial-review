import assert from "node:assert/strict";
import test from "node:test";
import { resolveWebsiteDiscovery, validateWebsite } from "../packages/cli/dist/index.js";

function jsonResponse(url, value, status = 200) {
  const response = new Response(typeof value === "string" ? value : JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

const projectDiscovery = {
  schema: "spatial-review-discovery/v1",
  version: 1,
  name: "Project site",
  websiteUrl: "../",
  liveCapture: "../?spatial-review-capture=1",
};

test("CLI discovery falls back from the canonical root to a project manifest", async () => {
  const calls = [];
  const resolved = await resolveWebsiteDiscovery("https://owner.github.io/project/", {
    fetch: async (url) => {
      calls.push(url);
      return url === "https://owner.github.io/.well-known/spatial-review.json"
        ? jsonResponse(url, {}, 404)
        : jsonResponse(url, projectDiscovery);
    },
  });
  assert.deepEqual(calls, [
    "https://owner.github.io/.well-known/spatial-review.json",
    "https://owner.github.io/project/.well-known/spatial-review.json",
  ]);
  assert.equal(resolved.discoveryUrl, calls[1]);
  assert.equal(resolved.discovery.websiteUrl, "https://owner.github.io/project/");
  assert.deepEqual(resolved.attempts.map((attempt) => attempt.outcome), ["unavailable", "compatible"]);
});

test("CLI discovery honors an explicit same-origin locator first", async () => {
  const calls = [];
  const explicit = "https://owner.github.io/project/review-manifest.json";
  const resolved = await resolveWebsiteDiscovery("https://owner.github.io/project/", {
    discoveryUrl: explicit,
    fetch: async (url) => { calls.push(url); return jsonResponse(url, projectDiscovery); },
  });
  assert.deepEqual(calls, [explicit]);
  assert.equal(resolved.discoveryUrl, explicit);
});

test("CLI diagnostics distinguish unavailable and invalid discovery documents", async () => {
  await assert.rejects(
    resolveWebsiteDiscovery("https://owner.github.io/project/", {
      fetch: async (url) => url.includes("/project/")
        ? jsonResponse(url, "not JSON")
        : jsonResponse(url, {}, 404),
    }),
    (error) => {
      assert.match(error.message, /unavailable \(HTTP 404\)/);
      assert.match(error.message, /invalid \(Spatial Review discovery document is not valid JSON\.\)/);
      assert.match(error.message, /owner\.github\.io\/project\/\.well-known/);
      return true;
    },
  );
});

test("CLI keeps old root-only producers compatible and prints attempted URLs", async () => {
  const root = "https://project.example/.well-known/spatial-review.json";
  const output = await validateWebsite("https://project.example/app/", {
    fetch: async (url) => {
      assert.equal(url, root);
      return jsonResponse(url, { ...projectDiscovery, name: "Legacy root", websiteUrl: "https://project.example/app/" });
    },
  });
  assert.match(output, /Compatible: Legacy root/);
  assert.match(output, new RegExp(`Discovery: ${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(output, /compatible \(valid discovery document\)/);
  assert.match(output, /discovery=https%3A%2F%2Fproject\.example%2F\.well-known%2Fspatial-review\.json/);
});

test("CLI rejects discovery redirects that escape the website origin", async () => {
  await assert.rejects(
    resolveWebsiteDiscovery("https://project.example/app/", {
      discoveryUrl: "https://project.example/custom.json",
      fetch: async (url) => jsonResponse("https://cdn.example/custom.json", projectDiscovery),
    }),
    /redirected outside https:\/\/project\.example/,
  );
});
