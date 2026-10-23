import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  decodePreparedReviewCatalog,
  encodePreparedReviewPackage,
  normalizePreparedReviewManifest,
  preparedReviewSha256,
  PREPARED_REVIEW_LIMITS,
  type PreparedReviewPackage,
  type PrepareReviewPackageOptions,
  type PreparedReviewTexture,
} from "@alterno-dev/spatial-review-protocol";
import { exportPreparedReviewPackage, prepareAssetTransfer, type ExportPreparedReviewOptions, type PreparedReviewRegistry } from "@alterno-dev/spatial-review";
import { validateReviewIndex } from "@alterno-dev/spatial-review-validator";

type CaptureInput = Omit<PrepareReviewPackageOptions, "textures"> & { schema: "spatial-review-capture/v1"; index: unknown; textures?: Array<{ resourceId: string; path: string; contentType: string }> };

function containedPath(root: string, candidate: string) {
  if (isAbsolute(candidate)) throw new Error("Package and texture paths must be relative.");
  const result = resolve(root, candidate);
  const inside = relative(root, result);
  if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error("Package and texture paths must stay inside their directory.");
  return result;
}

async function readCapturedJson(input: string): Promise<PreparedReviewPackage> {
  const raw = await readFile(input);
  if (raw.byteLength > PREPARED_REVIEW_LIMITS.totalBytes) throw new Error("The captured input exceeds the package byte budget.");
  const value = JSON.parse(raw.toString("utf8")) as CaptureInput;
  if (value.schema !== "spatial-review-capture/v1") throw new Error("JSON input must be a spatial-review-capture/v1 from an actual canonical capture.");
  const result = validateReviewIndex(value.index);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  const root = await realpath(dirname(input));
  const textures: PreparedReviewTexture[] = [];
  for (const texture of value.textures ?? []) {
    const filename = await realpath(containedPath(root, texture.path));
    containedPath(root, relative(root, filename));
    const bytes = await readFile(filename);
    textures.push({ resourceId: texture.resourceId, contentType: texture.contentType, bytes });
  }
  const index = { ...result.value, assetCatalog: { ...result.value.assetCatalog, assets: result.value.assetCatalog.assets.map((asset) =>
    prepareAssetTransfer(asset, PREPARED_REVIEW_LIMITS.totalBytes, { typedInstances: true }).asset) } };
  return encodePreparedReviewPackage(index, { source: value.source, fidelity: value.fidelity, captureId: value.captureId, capturedAt: value.capturedAt, textures });
}

/** Run an explicitly supplied local capture module, or package a canonical
 * captured JSON index with binary texture sidecars. Never fetch proxy exports. */
export async function prepareReviewPackage(inputPath: string, outputDirectory: string) {
  const input = resolve(inputPath);
  let result: PreparedReviewPackage;
  if (extname(input).toLowerCase() === ".json") result = await readCapturedJson(input);
  else {
    const module = await import(pathToFileURL(input).href);
    const capture = typeof module.default === "function" ? await module.default() : module.default ?? module;
    if (capture?.registry && capture?.options) result = await exportPreparedReviewPackage(capture.registry as PreparedReviewRegistry, capture.options as ExportPreparedReviewOptions);
    else if (capture?.manifest && Array.isArray(capture.files)) result = capture;
    else throw new Error("Capture module must export { registry, options }, or a factory returning an exported prepared package.");
  }
  const manifest = normalizePreparedReviewManifest(result.manifest, "https://package.invalid/manifest.json");
  const descriptors = [manifest.catalog, ...manifest.resources];
  const buffers = new Map<string, ArrayBuffer>();
  const seen = new Set<string>();
  const output = resolve(outputDirectory);
  for (const file of result.files) {
    containedPath(output, file.path);
    if (seen.has(file.path) || !(file.bytes instanceof Uint8Array)) throw new Error("The capture module returned invalid or duplicate package files.");
    seen.add(file.path);
  }
  for (const descriptor of descriptors) {
    const packagePath = new URL(descriptor.url).pathname.slice(1);
    const file = result.files.find((entry) => entry.path === packagePath);
    if (!file || file.bytes.byteLength !== descriptor.byteLength || await preparedReviewSha256(file.bytes) !== descriptor.sha256) throw new Error(`Package file ${packagePath} does not match its manifest.`);
    const resource = manifest.resources.find((entry) => entry.url === descriptor.url);
    if (resource?.kind === "buffer") buffers.set(resource.id, new Uint8Array(file.bytes).buffer);
  }
  const catalogFile = result.files.find((file) => file.path === new URL(manifest.catalog.url).pathname.slice(1))!;
  const decoded = decodePreparedReviewCatalog(JSON.parse(new TextDecoder().decode(catalogFile.bytes)), manifest, buffers);
  const validation = validateReviewIndex(decoded.index);
  if (!validation.ok) throw new Error(validation.errors.join("\n"));
  // A caller-supplied factory cannot substitute an unverified manifest file.
  result.files = result.files.filter((file) => file.path !== "manifest.json");
  result.files.push({ path: "manifest.json", contentType: "application/json", bytes: new TextEncoder().encode(JSON.stringify(result.manifest)) });
  await mkdir(output); // Refuse to overwrite an existing export.
  for (const file of result.files) {
    const filename = containedPath(output, file.path);
    await mkdir(dirname(filename), { recursive: true });
    await writeFile(filename, file.bytes, { flag: "wx" });
  }
  const bytes = result.files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  return `Prepared: ${output}\nBuild: ${manifest.buildId}\nCapture: ${manifest.captureId}\nResources: ${manifest.resources.length}\nBytes: ${bytes}\n`;
}
