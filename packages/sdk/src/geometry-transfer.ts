import type { AssetGeometry, ReviewAsset3D } from "@alterno-dev/spatial-review-protocol";

/** Only transfer owned copies. Detaching renderer buffers or the serialization cache
 * would corrupt the source scene and subsequent handoffs. */
export function prepareAssetTransfer(source: ReviewAsset3D, maxBytes = 64 * 1024 * 1024) {
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
  source.nodes.forEach((node) => { check(node.geometry); bytes += (node.instances?.length ?? 0) * 16 * 8; });
  if (bytes > maxBytes) throw new RangeError("The asset exceeds the negotiated transfer budget.");
  const asset = structuredClone(source);
  const buffers = new Set<ArrayBuffer>();
  seen.clear();
  const compact = (geometry: AssetGeometry | undefined) => {
    if (!geometry || geometry.kind !== "mesh") return;
    if (seen.has(geometry)) return;
    seen.add(geometry);
    geometry.positions = geometry.positions instanceof Float32Array ? geometry.positions : Float32Array.from(geometry.positions);
    if (geometry.normals) geometry.normals = geometry.normals instanceof Float32Array ? geometry.normals : Float32Array.from(geometry.normals);
    if (geometry.uvs) geometry.uvs = geometry.uvs instanceof Float32Array ? geometry.uvs : Float32Array.from(geometry.uvs);
    if (geometry.indices && Array.isArray(geometry.indices)) geometry.indices = Uint32Array.from(geometry.indices);
    for (const array of [geometry.positions, geometry.normals, geometry.uvs, geometry.indices]) {
      if (array && ArrayBuffer.isView(array)) buffers.add(array.buffer as ArrayBuffer);
    }
  };
  asset.geometries?.forEach((definition) => compact(definition.geometry)); asset.nodes.forEach((node) => compact(node.geometry));
  return { asset, transfer: [...buffers], bytes };
}
