import type { AssetGeometry, AssetInstanceData, ReviewAsset3D } from "@alterno-dev/spatial-review-protocol";

export type PrepareAssetTransferOptions = {
  /** Negotiated asset-stream-v1 transfers flatten instance matrices into one
   * owned Float32Array. Legacy progressive transfers retain number[][] JSON. */
  typedInstances?: boolean;
};

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

/** Only transfer owned copies. Detaching renderer buffers or the serialization cache
 * would corrupt the source scene and subsequent handoffs. */
export function prepareAssetTransfer(source: ReviewAsset3D, maxBytes = 64 * 1024 * 1024, options: PrepareAssetTransferOptions = {}) {
  let bytes = 0;
  const seen = new Set<AssetGeometry>();
  const check = (geometry: AssetGeometry | undefined) => {
    if (!geometry || geometry.kind !== "mesh" || seen.has(geometry)) return;
    seen.add(geometry);
    for (const array of [geometry.positions, geometry.normals, geometry.uvs, geometry.indices]) {
      if (array) bytes += ArrayBuffer.isView(array) ? array.byteLength : array.length * 4;
    }
  };
  source.geometries?.forEach((definition) => check(definition.geometry));
  source.nodes.forEach((node) => {
    check(node.geometry);
    if (node.instances !== undefined && node.instanceData !== undefined) throw new TypeError("An asset node cannot use both legacy and typed instance encodings.");
    if (node.instances) {
      if (node.instances.length > 100_000 || node.instances.some((matrix) => !Array.isArray(matrix) || matrix.length !== 16 || !matrix.every(Number.isFinite))) throw new TypeError("Legacy instance transforms must be finite 4x4 matrices.");
      bytes += node.instances.length * 16 * (options.typedInstances ? 4 : 8);
    }
    if (node.instanceData) bytes += instanceBytes(node.instanceData, maxBytes);
  });
  if (bytes > maxBytes) throw new RangeError("The asset exceeds the negotiated transfer budget.");
  const asset = structuredClone(source);
  const buffers = new Set<ArrayBuffer>();
  seen.clear();
  const compact = (geometry: AssetGeometry | undefined) => {
    if (!geometry || geometry.kind !== "mesh") return;
    if (seen.has(geometry)) return;
    seen.add(geometry);
    geometry.positions = Float32Array.from(geometry.positions);
    if (geometry.normals) geometry.normals = Float32Array.from(geometry.normals);
    if (geometry.uvs) geometry.uvs = Float32Array.from(geometry.uvs);
    if (geometry.indices) geometry.indices = geometry.indices instanceof Uint16Array ? Uint16Array.from(geometry.indices) : Uint32Array.from(geometry.indices);
    for (const array of [geometry.positions, geometry.normals, geometry.uvs, geometry.indices]) {
      if (array && ArrayBuffer.isView(array)) buffers.add(array.buffer as ArrayBuffer);
    }
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
    buffers.add(instanceData.transforms.buffer as ArrayBuffer);
    if (instanceData.colors) buffers.add(instanceData.colors.buffer as ArrayBuffer);
    if (instanceData.stableIds) buffers.add(instanceData.stableIds.buffer as ArrayBuffer);
  });
  return { asset, transfer: [...buffers], bytes };
}
