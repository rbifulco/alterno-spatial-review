#!/usr/bin/env node
import { discoveryUrlForWebsite, spatialReviewEditorUrl } from "@alterno-dev/spatial-review-protocol";
import { validateAssetDocument, validateDiscovery } from "@alterno-dev/spatial-review-validator";

async function json(url: string) {
  const response = await fetch(url, { headers: { accept: "application/json" }, redirect: "follow" });
  if (!response.ok) throw new Error(`${url} returned ${response.status}.`);
  return response.json();
}

async function validate(website: string) {
  const discoveryUrl = discoveryUrlForWebsite(website);
  const result = validateDiscovery(await json(discoveryUrl), discoveryUrl);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  const discovery = result.value;
  if (discovery.scene) await json(discovery.scene);
  if (discovery.assets) {
    const assets = validateAssetDocument(await json(discovery.assets));
    if (!assets.ok) throw new Error(assets.errors.join("\n"));
  }
  process.stdout.write(`Compatible: ${discovery.name}\nScene: ${discovery.scene ? "yes" : "no"}\nAssets: ${discovery.assets ? "yes" : "no"}\nLive: ${discovery.liveCapture ? "yes" : "no"}\nOpen review: ${spatialReviewEditorUrl(discovery.websiteUrl)}\n`);
}

const [command, website] = process.argv.slice(2);
if (command !== "validate" || !website) {
  process.stderr.write("Usage: spatial-review validate <website-url>\n");
  process.exitCode = 2;
} else validate(website).catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : error}\n`); process.exitCode = 1; });
