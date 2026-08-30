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

const emptyScene = { schema: "scene-actors/v1", actors: [] };
const emptyAssets = { schema: "asset-review-3d/v1", id: "assets", name: "Assets", units: "m", assets: [] };

test("CLI normalizes a bare host before binding discovery to its website origin", async () => {
  const discoveryUrl = "https://project.example/.well-known/spatial-review.json";
  const resolved = await resolveWebsiteDiscovery("project.example/app/", {
    fetch: async (url) => {
      assert.equal(url, discoveryUrl);
      return jsonResponse(url, { ...projectDiscovery, websiteUrl: "https://project.example/app/" });
    },
  });
  assert.equal(resolved.discoveryUrl, discoveryUrl);
  assert.equal(resolved.discovery.websiteUrl, "https://project.example/app/");
});

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

test("CLI binds an advertised website to the origin being validated", async () => {
  await assert.rejects(
    resolveWebsiteDiscovery("https://project.example/app/", {
      discoveryUrl: "https://project.example/discovery.json",
      fetch: async (url) => jsonResponse(url, { ...projectDiscovery, websiteUrl: "http://127.0.0.1:8080/" }),
    }),
    /websiteUrl must remain on https:\/\/project\.example/,
  );
});

test("CLI refuses cross-origin advertised documents before fetching them", async () => {
  const discoveryUrl = "https://project.example/discovery.json";
  const calls = [];
  await assert.rejects(
    validateWebsite("https://project.example/app/", {
      discoveryUrl,
      fetch: async (url) => {
        calls.push(url);
        if (url === discoveryUrl) return jsonResponse(url, { ...projectDiscovery, websiteUrl: "https://project.example/app/", scene: "http://127.0.0.1:9000/scene.json" });
        assert.fail(`unexpected fetch of ${url}`);
      },
    }),
    /origin http:\/\/127\.0\.0\.1:9000 is not trusted/,
  );
  assert.deepEqual(calls, [discoveryUrl]);
});

test("CLI checks each static-document redirect before following it", async () => {
  const discoveryUrl = "https://project.example/discovery.json";
  const sceneUrl = "https://project.example/scene.json";
  const calls = [];
  await assert.rejects(
    validateWebsite("https://project.example/app/", {
      discoveryUrl,
      fetch: async (url) => {
        calls.push(url);
        if (url === discoveryUrl) return jsonResponse(url, { ...projectDiscovery, websiteUrl: "https://project.example/app/", scene: sceneUrl });
        if (url === sceneUrl) {
          const response = new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
          Object.defineProperty(response, "url", { value: sceneUrl });
          return response;
        }
        assert.fail(`unexpected fetch of ${url}`);
      },
    }),
    /origin http:\/\/169\.254\.169\.254 is not trusted/,
  );
  assert.deepEqual(calls, [discoveryUrl, sceneUrl]);
});

test("CLI supports explicit CDN origins without weakening redirect checks", async () => {
  const discoveryUrl = "https://project.example/discovery.json";
  const assetsUrl = "https://assets.example/catalog.json";
  const output = await validateWebsite("https://project.example/app/", {
    discoveryUrl,
    allowedDocumentOrigins: ["https://assets.example"],
    fetch: async (url) => url === discoveryUrl
      ? jsonResponse(url, { ...projectDiscovery, websiteUrl: "https://project.example/app/", assets: assetsUrl })
      : jsonResponse(url, emptyAssets),
  });
  assert.match(output, /Assets: yes/);
});

test("CLI validates scene documents instead of only downloading them", async () => {
  const discoveryUrl = "https://project.example/discovery.json";
  await assert.rejects(
    validateWebsite("https://project.example/app/", {
      discoveryUrl,
      fetch: async (url) => url === discoveryUrl
        ? jsonResponse(url, { ...projectDiscovery, websiteUrl: "https://project.example/app/", scene: "./scene.json" })
        : jsonResponse(url, { ...emptyScene, actors: [{}] }),
    }),
    /actorId.*assetId|requires bounded assetId/,
  );
});

test("CLI rejects incomplete asset records and malformed render structure", async () => {
  const discoveryUrl = "https://project.example/discovery.json";
  await assert.rejects(
    validateWebsite("https://project.example/app/", {
      discoveryUrl,
      fetch: async (url) => url === discoveryUrl
        ? jsonResponse(url, { ...projectDiscovery, websiteUrl: "https://project.example/app/", assets: "./assets.json" })
        : jsonResponse(url, { ...emptyAssets, assets: [{}] }),
    }),
    /assets\[0\].*(id|nodes|materials|feedback)/,
  );
});

test("CLI rejects static asset records that contain no reviewable geometry", async () => {
  const discoveryUrl = "https://project.example/discovery.json";
  const emptyAsset = {
    id: "empty", name: "Empty", tags: [], nodes: [], geometries: [], materials: [],
    feedback: { status: "unreviewed", summary: "", annotations: [], modifications: [] },
  };
  await assert.rejects(
    validateWebsite("https://project.example/app/", {
      discoveryUrl,
      fetch: async (url) => url === discoveryUrl
        ? jsonResponse(url, { ...projectDiscovery, websiteUrl: "https://project.example/app/", assets: "./assets.json" })
        : jsonResponse(url, { ...emptyAssets, assets: [emptyAsset] }),
    }),
    /must contain renderable geometry/,
  );
});

test("CLI verifies actor asset references when both static documents are advertised", async () => {
  const discoveryUrl = "https://project.example/discovery.json";
  const scene = { ...emptyScene, actors: [{
    actorId: "actor", assetId: "missing", name: "Actor", sourceRef: "fixture#actor", category: "Fixture",
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    bounds: { center: [0, 0, 0], size: [1, 1, 1] },
  }] };
  await assert.rejects(
    validateWebsite("https://project.example/app/", {
      discoveryUrl,
      fetch: async (url) => {
        if (url === discoveryUrl) return jsonResponse(url, { ...projectDiscovery, websiteUrl: "https://project.example/app/", scene: "./scene.json", assets: "./assets.json" });
        return jsonResponse(url, url.endsWith("scene.json") ? scene : emptyAssets);
      },
    }),
    /assets missing from the advertised catalog: missing/,
  );
});
