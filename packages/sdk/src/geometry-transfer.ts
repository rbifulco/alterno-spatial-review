import type { AssetGeometry, AssetInstanceData, ReviewAsset3D } from "@alterno-dev/spatial-review-protocol";

export type PrepareAssetTransferOptions = {
  /** Negotiated asset-stream-v1 transfers flatten instance matrices into one
   * owned Float32Array. Legacy progressive transfers retain number[][] JSON. */
  typedInstances?: boolean;
};

function enumerableDataEntries(value: object) {
  return Object.keys(value).map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) throw new TypeError("Spatial Review transfers must contain only data properties.");
    return [key, descriptor.value] as const;
  });
}

function measureSpatialReviewTransferBytes(value: unknown, maxBytes: number, projections = new WeakMap<object, number>()) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError("The transfer budget must be a bounded non-negative integer.");
  const seen = new WeakSet<object>(), active = new WeakSet<object>(), buffers = new WeakSet<object>();
  let bytes = 0;
  const add = (amount: number) => {
    bytes += amount;
    if (!Number.isSafeInteger(bytes) || bytes > maxBytes) throw new RangeError("The payload exceeds the negotiated transfer budget.");
  };
  const visit = (candidate: unknown): void => {
    if (candidate === null || candidate === undefined) { add(1); return; }
    if (typeof candidate === "string") { add(8 + candidate.length * 4); return; }
    if (typeof candidate === "number") { add(8); return; }
    if (typeof candidate === "boolean") { add(4); return; }
    if (typeof candidate !== "object") throw new TypeError("Spatial Review transfers contain an unsupported value.");
    const projection = projections.get(candidate);
    if (projection !== undefined) { add(projection); return; }
    if (candidate instanceof ArrayBuffer) { if (!buffers.has(candidate)) { buffers.add(candidate); add(candidate.byteLength); } return; }
    if (ArrayBuffer.isView(candidate)) { const buffer = candidate.buffer as object; if (!buffers.has(buffer)) { buffers.add(buffer); add(candidate.buffer.byteLength); } return; }
    if (active.has(candidate)) throw new TypeError("Spatial Review transfers must not contain cycles.");
    if (seen.has(candidate)) return;
    const prototype = Object.getPrototypeOf(candidate);
    if (!Array.isArray(candidate) && prototype !== Object.prototype && prototype !== null) throw new TypeError("Spatial Review transfers must contain only plain objects, arrays, and supported buffers.");
    seen.add(candidate); active.add(candidate);
    const entries = enumerableDataEntries(candidate);
    if (Array.isArray(candidate)) {
      add(16 + candidate.length * 8);
      entries.forEach(([key, entry]) => {
        if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= candidate.length) add(8 + key.length * 4);
        visit(entry);
      });
    } else { add(16); entries.forEach(([key, entry]) => { add(8 + key.length * 4); visit(entry); }); }
    active.delete(candidate);
  };
  visit(value);
  return bytes;
}

function objectReferenceCounts(value: unknown) {
  const counts = new WeakMap<object, number>();
  const visited = new WeakSet<object>();
  const visit = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object" || visited.has(candidate)) return;
    visited.add(candidate);
    if (candidate instanceof ArrayBuffer || ArrayBuffer.isView(candidate)) return;
    enumerableDataEntries(candidate).forEach(([, child]) => {
      if (!child || typeof child !== "object") return;
      counts.set(child, (counts.get(child) ?? 0) + 1);
      visit(child);
    });
  };
  if (value && typeof value === "object") counts.set(value, 1);
  visit(value);
  return counts;
}

function instanceBytes(instanceData: AssetInstanceData, maxBytes: number) {
  if (instanceData.encoding !== "matrix-f32-v1" || !Number.isSafeInteger(instanceData.count) || instanceData.count < 0 || instanceData.count > 100_000) throw new TypeError("The asset contains invalid typed instance metadata.");
  if (!(instanceData.transforms instanceof Float32Array) || instanceData.transforms.length !== instanceData.count * 16 || !instanceData.transforms.every(Number.isFinite)) throw new TypeError("Typed instance transforms must contain count * 16 finite Float32 values.");
  if (instanceData.colors !== undefined && (!(instanceData.colors instanceof Float32Array || instanceData.colors instanceof Uint8Array)
    || (instanceData.colors.length !== instanceData.count * 3 && instanceData.colors.length !== instanceData.count * 4)
    || (instanceData.colors instanceof Float32Array && !instanceData.colors.every(Number.isFinite)))) throw new TypeError("Typed instance colors must contain three or four finite channels per instance.");
  if (instanceData.stableIds !== undefined && (!(instanceData.stableIds instanceof Uint32Array) || instanceData.stableIds.length !== instanceData.count || new Set(instanceData.stableIds).size !== instanceData.count)) throw new TypeError("Typed stable instance IDs must contain one unique Uint32 value per instance.");
  if (instanceData.selection !== undefined && instanceData.selection !== "aggregate" && instanceData.selection !== "instance") throw new TypeError("Typed instance selection must be aggregate or instance.");
  const bytes = instanceData.transforms.byteLength + (instanceData.colors?.byteLength ?? 0) + (instanceData.stableIds?.byteLength ?? 0);
  if (bytes > maxBytes) throw new RangeError("The asset exceeds the negotiated transfer budget.");
  return bytes;
}

/** Collect only buffers owned by an already-prepared asset clone. */
export function assetTransferBuffers(source: ReviewAsset3D) {
  const buffers = new Set<ArrayBuffer>();
  const geometries = new Set<AssetGeometry>();
  const collectGeometry = (geometry: AssetGeometry | undefined) => {
    if (!geometry || geometry.kind !== "mesh" || geometries.has(geometry)) return;
    geometries.add(geometry);
    for (const array of [geometry.positions, geometry.normals, geometry.uvs, geometry.indices]) {
      if (array && ArrayBuffer.isView(array)) buffers.add(array.buffer as ArrayBuffer);
    }
  };
  source.geometries?.forEach((definition) => collectGeometry(definition.geometry));
  source.nodes.forEach((node) => {
    collectGeometry(node.geometry);
    const data = node.instanceData;
    if (!data) return;
    buffers.add(data.transforms.buffer as ArrayBuffer);
    if (data.colors) buffers.add(data.colors.buffer as ArrayBuffer);
    if (data.stableIds) buffers.add(data.stableIds.buffer as ArrayBuffer);
  });
  return [...buffers];
}

/** Only transfer owned copies. Detaching renderer buffers or the serialization cache
 * would corrupt the source scene and subsequent handoffs. */
export function prepareAssetTransfer(source: ReviewAsset3D, maxBytes = 64 * 1024 * 1024, options: PrepareAssetTransferOptions = {}) {
  const references = objectReferenceCounts(source);
  const projections = new WeakMap<object, number>();
  const projectionRequests = new Map<object, { bytes: number; count: number }>();
  let aliasedProjectionBytes = 0;
  const project = (value: unknown, projectedBytes: number) => {
    if (!value || typeof value !== "object") return;
    const request = projectionRequests.get(value);
    if (request) {
      if (request.bytes !== projectedBytes) throw new TypeError("A projected transfer value cannot use conflicting encodings.");
      request.count += 1;
    } else projectionRequests.set(value, { bytes: projectedBytes, count: 1 });
  };
  const seen = new Set<AssetGeometry>();
  const seenNodes = new Set<object>();
  const seenInstanceData = new Set<AssetInstanceData>();
  const check = (geometry: AssetGeometry | undefined) => {
    if (!geometry || geometry.kind !== "mesh" || seen.has(geometry)) return;
    seen.add(geometry);
    project(geometry.positions, geometry.positions.length * 4);
    if (geometry.normals) project(geometry.normals, geometry.normals.length * 4);
    if (geometry.uvs) project(geometry.uvs, geometry.uvs.length * 4);
    if (geometry.indices) project(geometry.indices, geometry.indices.length * (geometry.indices instanceof Uint16Array ? 2 : 4));
  };
  source.geometries?.forEach((definition) => check(definition.geometry));
  source.nodes.forEach((node) => {
    check(node.geometry);
    if (seenNodes.has(node)) return;
    seenNodes.add(node);
    if (node.instances !== undefined && node.instanceData !== undefined) throw new TypeError("An asset node cannot use both legacy and typed instance encodings.");
    if (node.instances) {
      if (node.instances.length > 100_000 || node.instances.some((matrix) => !Array.isArray(matrix) || matrix.length !== 16 || !matrix.every(Number.isFinite))) throw new TypeError("Legacy instance transforms must be finite 4x4 matrices.");
      if (options.typedInstances) project(node.instances, 128 + node.instances.length * 16 * 4);
    }
    if (node.instanceData && !seenInstanceData.has(node.instanceData)) {
      seenInstanceData.add(node.instanceData);
      instanceBytes(node.instanceData, maxBytes);
      project(node.instanceData.transforms, node.instanceData.transforms.byteLength);
      if (node.instanceData.colors) project(node.instanceData.colors, node.instanceData.colors.byteLength);
      if (node.instanceData.stableIds) project(node.instanceData.stableIds, node.instanceData.stableIds.byteLength);
    }
  });
  projectionRequests.forEach(({ bytes: projectedBytes, count }, value) => {
    const referenceCount = references.get(value) ?? 0;
    if (count >= referenceCount) projections.set(value, projectedBytes);
    else aliasedProjectionBytes += projectedBytes * count;
  });
  if (aliasedProjectionBytes > maxBytes) throw new RangeError("The payload exceeds the negotiated transfer budget.");
  const bytes = measureSpatialReviewTransferBytes(source, maxBytes - aliasedProjectionBytes, projections) + aliasedProjectionBytes;
  const asset = structuredClone(source);
  seen.clear();
  const compact = (geometry: AssetGeometry | undefined) => {
    if (!geometry || geometry.kind !== "mesh") return;
    if (seen.has(geometry)) return;
    seen.add(geometry);
    geometry.positions = Float32Array.from(geometry.positions);
    if (geometry.normals) geometry.normals = Float32Array.from(geometry.normals);
    if (geometry.uvs) geometry.uvs = Float32Array.from(geometry.uvs);
    if (geometry.indices) geometry.indices = geometry.indices instanceof Uint16Array ? Uint16Array.from(geometry.indices) : Uint32Array.from(geometry.indices);
  };
  asset.geometries?.forEach((definition) => compact(definition.geometry));
  asset.nodes.forEach((node) => {
    compact(node.geometry);
    if (options.typedInstances && node.instances) {
      const transforms = new Float32Array(node.instances.length * 16);
      node.instances.forEach((matrix, index) => transforms.set(matrix, index * 16));
      node.instanceData = { encoding: "matrix-f32-v1", count: node.instances.length, transforms };
      delete node.instances;
    }
    const instanceData = node.instanceData;
    if (!instanceData) return;
    instanceData.transforms = Float32Array.from(instanceData.transforms);
    if (instanceData.colors instanceof Float32Array) instanceData.colors = Float32Array.from(instanceData.colors);
    else if (instanceData.colors instanceof Uint8Array) instanceData.colors = Uint8Array.from(instanceData.colors);
    if (instanceData.stableIds) instanceData.stableIds = Uint32Array.from(instanceData.stableIds);
  });
  return { asset, transfer: assetTransferBuffers(asset), bytes };
}
