import {
  ASSET_REVIEW_SCHEMA,
  SCENE_ACTORS_SCHEMA,
  SPATIAL_REVIEW_ASSET_CANCEL,
  SPATIAL_REVIEW_ASSET_PROGRESS,
  SPATIAL_REVIEW_ASSET_REQUEST,
  SPATIAL_REVIEW_ASSET_RESPONSE,
  SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY,
  SPATIAL_REVIEW_INDEX_SCHEMA,
  SPATIAL_REVIEW_SOURCE_STATUS,
  normalizeSpatialReviewDiscovery,
  validateSceneOwnership,
  type AssetInstanceData,
  type AssetReviewDocument3D,
  type AssetStreamDescriptor,
  type SpatialReviewAssetCancelMessage,
  type SpatialReviewAssetProgressMessage,
  type SpatialReviewAssetRequest,
  type SpatialReviewAssetResponse,
  type SpatialReviewAssetStreamOffer,
  type SpatialReviewDiscovery,
  type SpatialReviewIndex,
  type SpatialReviewScene,
  type SpatialReviewSourceStatusMessage,
} from "@alterno-dev/spatial-review-protocol";

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finiteVec3 = (value: unknown) => Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
const finiteVec2 = (value: unknown) => Array.isArray(value) && value.length === 2 && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));

const MAX_NAVIGATION_SEQUENCES = 200;
const MAX_NAVIGATION_STOPS = 5_000;
const MAX_NAVIGATION_SEGMENTS = 5_000;
const MAX_NAVIGATION_POINTS = 50_000;
const MAX_STREAM_REPRESENTATIONS = 32;
const MAX_STREAM_ESTIMATED_BYTES = 1024 * 1024 * 1024;
const MAX_INSTANCE_COUNT = 100_000;
const MAX_REVISION_LENGTH = 200;
const MAX_SCENE_ACTORS = 100_000;
const MAX_ASSETS = 2_000;
const MAX_ASSET_NODES = 100_000;
const MAX_ASSET_MATERIALS = 20_000;
const MAX_ASSET_GEOMETRIES = 100_000;
const MAX_ASSET_GEOMETRY_VALUES = 16_000_000;
const MAX_ASSET_HIERARCHY_DEPTH = 256;
const MAX_ASSET_PRIMITIVE_SEGMENTS = 256;
const MAX_ASSET_PRIMITIVE_DIMENSION = 1_000_000;
const MAX_ASSET_ALLOCATION_BYTES = 192 * 1024 * 1024;

const boundedId = (value: unknown, max = 500) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const boundedText = (value: unknown, max = 10_000) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const nonNegativeInteger = (value: unknown, max = Number.MAX_SAFE_INTEGER) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;

function finiteTransform(value: unknown) {
  return object(value) && finiteVec3(value.position) && finiteVec3(value.rotation) && finiteVec3(value.scale)
    && (value.scale as number[]).every((component) => Math.abs(component) >= 1e-8);
}

function finiteBounds(value: unknown) {
  return object(value) && finiteVec3(value.center) && finiteVec3(value.size)
    && (value.size as number[]).every((component) => component >= 0);
}

function enumerableDataEntries(value: object) {
  return Object.keys(value).map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) throw new TypeError("Spatial Review transfers must contain only data properties.");
    return [key, descriptor.value] as const;
  });
}

function measureSpatialReviewTransferBytes(value: unknown, maxBytes: number) {
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

function assetStreamErrors(value: unknown, label = "stream") {
  const errors: string[] = [];
  if (!object(value)) return [`${label} must be an object.`];
  if (value.capability !== SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY) errors.push(`${label}.capability must be ${SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY}.`);
  if (!boundedId(value.revision, MAX_REVISION_LENGTH)) errors.push(`${label}.revision must be a non-empty identifier of at most ${MAX_REVISION_LENGTH} characters.`);
  if (!Array.isArray(value.representations) || value.representations.length === 0 || value.representations.length > MAX_STREAM_REPRESENTATIONS) {
    errors.push(`${label}.representations must contain 1-${MAX_STREAM_REPRESENTATIONS} entries.`);
    return errors;
  }
  const ids = new Set<string>();
  value.representations.forEach((candidate, index) => {
    const representationLabel = `${label}.representations[${index}]`;
    if (!object(candidate)) { errors.push(`${representationLabel} must be an object.`); return; }
    if (!boundedId(candidate.id, 200)) errors.push(`${representationLabel}.id must be a non-empty identifier of at most 200 characters.`);
    else if (ids.has(candidate.id as string)) errors.push(`${label} contains duplicate representation id "${candidate.id}".`);
    else ids.add(candidate.id as string);
    if (!['overview', 'detail'].includes(String(candidate.purpose))) errors.push(`${representationLabel}.purpose must be overview or detail.`);
    if (!boundedId(candidate.revision, MAX_REVISION_LENGTH)) errors.push(`${representationLabel}.revision must be a non-empty identifier of at most ${MAX_REVISION_LENGTH} characters.`);
    if (!nonNegativeInteger(candidate.estimatedBytes, MAX_STREAM_ESTIMATED_BYTES)) errors.push(`${representationLabel}.estimatedBytes must be a bounded non-negative integer.`);
    for (const field of ["triangles", "instances"] as const) if (candidate[field] !== undefined && !nonNegativeInteger(candidate[field], MAX_INSTANCE_COUNT * 1_000)) errors.push(`${representationLabel}.${field} must be a bounded non-negative integer.`);
    if (!Array.isArray(candidate.attributes) || candidate.attributes.length > 4 || new Set(candidate.attributes).size !== candidate.attributes.length
      || candidate.attributes.some((attribute) => typeof attribute !== "string" || !["position", "normal", "uv", "color"].includes(attribute))) errors.push(`${representationLabel}.attributes must be unique supported attributes.`);
    if (candidate.geometricError !== undefined && (typeof candidate.geometricError !== "number" || !Number.isFinite(candidate.geometricError) || candidate.geometricError < 0)) errors.push(`${representationLabel}.geometricError must be finite and non-negative.`);
  });
  return errors;
}

function assetInstanceErrors(value: unknown, maxBytes: number, label = "instanceData") {
  const errors: string[] = [];
  if (!object(value)) return [`${label} must be an object.`];
  if (value.encoding !== "matrix-f32-v1") errors.push(`${label}.encoding must be matrix-f32-v1.`);
  if (!nonNegativeInteger(value.count, MAX_INSTANCE_COUNT)) errors.push(`${label}.count must be an integer between 0 and ${MAX_INSTANCE_COUNT}.`);
  const count = nonNegativeInteger(value.count, MAX_INSTANCE_COUNT) ? value.count as number : 0;
  if (!(value.transforms instanceof Float32Array) || value.transforms.length !== count * 16 || !value.transforms.every(Number.isFinite)) errors.push(`${label}.transforms must be a finite Float32Array with count * 16 entries.`);
  const colors = value.colors;
  if (colors !== undefined && (!(colors instanceof Float32Array || colors instanceof Uint8Array)
    || (colors.length !== count * 3 && colors.length !== count * 4)
    || (colors instanceof Float32Array && !colors.every(Number.isFinite)))) errors.push(`${label}.colors must contain three or four finite channels per instance.`);
  if (value.stableIds !== undefined && (!(value.stableIds instanceof Uint32Array) || value.stableIds.length !== count || new Set(value.stableIds).size !== value.stableIds.length)) errors.push(`${label}.stableIds must contain one unique Uint32 value per instance.`);
  if (value.selection !== undefined && value.selection !== "aggregate" && value.selection !== "instance") errors.push(`${label}.selection must be aggregate or instance.`);
  const bytes = (value.transforms instanceof Float32Array ? value.transforms.byteLength : 0)
    + (colors instanceof Float32Array || colors instanceof Uint8Array ? colors.byteLength : 0)
    + (value.stableIds instanceof Uint32Array ? value.stableIds.byteLength : 0);
  if (bytes > maxBytes) errors.push(`${label} exceeds the negotiated byte budget.`);
  return errors;
}

export function validateAssetStreamDescriptor(value: unknown): ValidationResult<AssetStreamDescriptor> {
  const errors = assetStreamErrors(value);
  return errors.length ? { ok: false, errors } : { ok: true, value: value as AssetStreamDescriptor };
}

export function validateSpatialReviewAssetStreamOffer(value: unknown): ValidationResult<SpatialReviewAssetStreamOffer> {
  const errors: string[] = [];
  if (!object(value)) errors.push("Asset stream offer must be an object.");
  else {
    if (value.capability !== SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY) errors.push(`capability must be ${SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY}.`);
    if (!nonNegativeInteger(value.maxConcurrentRequests, 16) || value.maxConcurrentRequests === 0) errors.push("maxConcurrentRequests must be an integer between 1 and 16.");
    if (!nonNegativeInteger(value.maxInFlightBytes, MAX_STREAM_ESTIMATED_BYTES) || value.maxInFlightBytes === 0) errors.push("maxInFlightBytes must be a positive bounded integer.");
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: value as SpatialReviewAssetStreamOffer };
}

export function validateAssetInstanceData(value: unknown, maxBytes = 64 * 1024 * 1024): ValidationResult<AssetInstanceData> {
  const errors = assetInstanceErrors(value, maxBytes);
  return errors.length ? { ok: false, errors } : { ok: true, value: value as AssetInstanceData };
}

function validateCurve(curve: unknown, label: string, stopIds: Set<string>, errors: string[]) {
  if (!object(curve) || typeof curve.kind !== "string") {
    errors.push(`${label} must be a curve object.`);
    return 0;
  }
  if (!["line", "quadratic-bezier", "cubic-bezier", "catmull-rom", "sampled"].includes(curve.kind)) {
    errors.push(`${label}.kind is not a supported curve type.`);
    return 0;
  }
  if (curve.kind === "sampled") {
    if (!Array.isArray(curve.samples) || curve.samples.length < 2 || curve.samples.some((sample) => !finiteVec3(sample))) {
      errors.push(`${label}.samples must contain at least two finite XYZ positions.`);
      return 0;
    }
    return curve.samples.length;
  }
  if (!Array.isArray(curve.points)) {
    errors.push(`${label}.points must be an array.`);
    return 0;
  }
  const required = curve.kind === "line" ? 2 : curve.kind === "quadratic-bezier" ? 3 : curve.kind === "cubic-bezier" ? 4 : 2;
  if (curve.points.length < required || (curve.kind !== "catmull-rom" && curve.points.length !== required)) {
    errors.push(`${label} has the wrong number of authored points for ${curve.kind}.`);
  }
  const ids = new Set<string>();
  curve.points.forEach((point, index) => {
    if (!object(point)) {
      errors.push(`${label}.points[${index}] must be an authored point object.`);
      return;
    }
    if (typeof point.id !== "string" || !point.id.trim()) errors.push(`${label}.points[${index}].id must be a non-empty string.`);
    else if (ids.has(point.id)) errors.push(`${label} contains duplicate point id "${point.id}".`);
    else ids.add(point.id);
    if (!finiteVec3(point.position)) errors.push(`${label}.points[${index}].position must be a finite XYZ position.`);
    if (!["stop", "through", "control", "control-in", "control-out"].includes(String(point.role))) errors.push(`${label}.points[${index}].role is not supported.`);
    if (point.stopId !== undefined && (typeof point.stopId !== "string" || !stopIds.has(point.stopId))) errors.push(`${label}.points[${index}].stopId does not reference a sequence stop.`);
  });
  if (curve.kind === "catmull-rom") {
    if (curve.closed !== undefined && typeof curve.closed !== "boolean") errors.push(`${label}.closed must be boolean when present.`);
    if (curve.curveType !== undefined && !["centripetal", "chordal", "catmullrom"].includes(String(curve.curveType))) errors.push(`${label}.curveType is not supported.`);
    if (curve.tension !== undefined && (typeof curve.tension !== "number" || !Number.isFinite(curve.tension))) errors.push(`${label}.tension must be finite when present.`);
  }
  return curve.points.length;
}

function validateNavigationSequence(sequence: unknown, index: number, errors: string[]) {
  const label = `scene.navigationSequences[${index}]`;
  if (!object(sequence) || typeof sequence.id !== "string" || !sequence.id.trim()) {
    errors.push(`${label}.id must be a non-empty string.`);
    return { stops: 0, segments: 0, points: 0 };
  }
  if (typeof sequence.name !== "string" || !sequence.name.trim()) errors.push(`${label}.name must be a non-empty string.`);
  if (!Array.isArray(sequence.stops) || sequence.stops.length === 0) errors.push(`${label}.stops must be a non-empty array.`);
  if (!Array.isArray(sequence.segments)) errors.push(`${label}.segments must be an array.`);
  const stops = Array.isArray(sequence.stops) ? sequence.stops : [];
  const segments = Array.isArray(sequence.segments) ? sequence.segments : [];
  const stopIds = new Set<string>();
  stops.forEach((stop, stopIndex) => {
    if (!object(stop)) {
      errors.push(`${label}.stops[${stopIndex}] must be a stop object.`);
      return;
    }
    if (typeof stop.id !== "string" || !stop.id.trim()) errors.push(`${label}.stops[${stopIndex}].id must be a non-empty string.`);
    else if (stopIds.has(stop.id)) errors.push(`${label} contains duplicate stop id "${stop.id}".`);
    else stopIds.add(stop.id);
    if (typeof stop.name !== "string" || !stop.name.trim()) errors.push(`${label}.stops[${stopIndex}].name must be a non-empty string.`);
    if (!finiteVec3(stop.camera)) errors.push(`${label}.stops[${stopIndex}].camera must be a finite XYZ position.`);
    if (!finiteVec3(stop.target)) errors.push(`${label}.stops[${stopIndex}].target must be a finite XYZ position.`);
    if (typeof stop.fov !== "number" || !Number.isFinite(stop.fov) || stop.fov <= 0 || stop.fov >= 180) errors.push(`${label}.stops[${stopIndex}].fov must be between 0 and 180 degrees.`);
  });
  const segmentIds = new Set<string>();
  let points = 0;
  segments.forEach((segment, segmentIndex) => {
    const segmentLabel = `${label}.segments[${segmentIndex}]`;
    if (!object(segment)) {
      errors.push(`${segmentLabel} must be a segment object.`);
      return;
    }
    if (typeof segment.id !== "string" || !segment.id.trim()) errors.push(`${segmentLabel}.id must be a non-empty string.`);
    else if (segmentIds.has(segment.id)) errors.push(`${label} contains duplicate segment id "${segment.id}".`);
    else segmentIds.add(segment.id);
    if (typeof segment.fromStopId !== "string" || !stopIds.has(segment.fromStopId)) errors.push(`${segmentLabel}.fromStopId does not reference a sequence stop.`);
    if (typeof segment.toStopId !== "string" || !stopIds.has(segment.toStopId)) errors.push(`${segmentLabel}.toStopId does not reference a sequence stop.`);
    if (typeof segment.weight !== "number" || !Number.isFinite(segment.weight) || segment.weight <= 0) errors.push(`${segmentLabel}.weight must be greater than zero.`);
    if (segment.lensStart !== undefined && (typeof segment.lensStart !== "number" || !Number.isFinite(segment.lensStart) || segment.lensStart < 0 || segment.lensStart > 1)) errors.push(`${segmentLabel}.lensStart must be between zero and one.`);
    points += validateCurve(segment.camera, `${segmentLabel}.camera`, stopIds, errors);
    if (!object(segment.aim) || typeof segment.aim.kind !== "string") errors.push(`${segmentLabel}.aim must be an aim object.`);
    else if (segment.aim.kind === "curve") points += validateCurve(segment.aim.curve, `${segmentLabel}.aim.curve`, stopIds, errors);
    else if (segment.aim.kind === "fixed-target" && !finiteVec3(segment.aim.target)) errors.push(`${segmentLabel}.aim.target must be a finite XYZ position.`);
    else if (segment.aim.kind === "path-facing") {
      if (typeof segment.aim.lookDistance !== "number" || !Number.isFinite(segment.aim.lookDistance) || segment.aim.lookDistance <= 0) errors.push(`${segmentLabel}.aim.lookDistance must be greater than zero.`);
      if (segment.aim.maximumPitchRatio !== undefined && (typeof segment.aim.maximumPitchRatio !== "number" || !Number.isFinite(segment.aim.maximumPitchRatio) || segment.aim.maximumPitchRatio < 0)) errors.push(`${segmentLabel}.aim.maximumPitchRatio must be zero or greater.`);
      if (segment.aim.turnFraction !== undefined && (typeof segment.aim.turnFraction !== "number" || !Number.isFinite(segment.aim.turnFraction) || segment.aim.turnFraction < 0 || segment.aim.turnFraction > 0.5)) errors.push(`${segmentLabel}.aim.turnFraction must be between zero and 0.5.`);
    } else if (!["curve", "fixed-target"].includes(segment.aim.kind)) errors.push(`${segmentLabel}.aim.kind is not supported.`);
  });
  return { stops: stops.length, segments: segments.length, points };
}

type AssetValidationBudget = { nodes: number; materials: number; geometries: number; geometryValues: number; instances: number; allocationBytes: number };

function emptyAssetValidationBudget(): AssetValidationBudget {
  return { nodes: 0, materials: 0, geometries: 0, geometryValues: 0, instances: 0, allocationBytes: 0 };
}

function finiteNumberSequence(value: unknown, typed: "float" | "index" = "float") {
  const supported = Array.isArray(value)
    || (typed === "float" && value instanceof Float32Array)
    || (typed === "index" && (value instanceof Uint16Array || value instanceof Uint32Array));
  if (!supported) return false;
  for (let index = 0; index < (value as ArrayLike<unknown>).length; index += 1) {
    if (Array.isArray(value) && !(index in value)) return false;
    const entry = (value as ArrayLike<unknown>)[index];
    if (typeof entry !== "number" || !Number.isFinite(entry)) return false;
  }
  return true;
}

function geometryErrors(value: unknown, label: string, budget: AssetValidationBudget) {
  const errors: string[] = [];
  if (!object(value)) return [`${label} must be a geometry object.`];
  budget.geometries += 1;
  if (value.kind === "primitive") {
    if (!["box", "sphere", "cylinder"].includes(String(value.primitive))) errors.push(`${label}.primitive is not supported.`);
    if (!finiteVec3(value.dimensions) || (value.dimensions as number[]).some((component) => component <= 0 || component > MAX_ASSET_PRIMITIVE_DIMENSION)) errors.push(`${label}.dimensions must contain three positive bounded finite values.`);
    const validSegments = value.segments === undefined || (typeof value.segments === "number" && Number.isSafeInteger(value.segments)
      && value.segments >= 3 && value.segments <= MAX_ASSET_PRIMITIVE_SEGMENTS);
    if (!validSegments) errors.push(`${label}.segments must be an integer between 3 and ${MAX_ASSET_PRIMITIVE_SEGMENTS}.`);
    const segments = validSegments && typeof value.segments === "number" ? value.segments : 32;
    if (value.primitive === "sphere") {
      const rows = Math.max(12, Math.round(segments * 0.62));
      budget.allocationBytes += (segments + 1) * (rows + 1) * 32 + segments * Math.max(1, rows - 1) * 6 * 4;
    } else if (value.primitive === "cylinder") budget.allocationBytes += (segments + 1) * 6 * 32 + segments * 18 * 4;
    else budget.allocationBytes += 24 * 32 + 36 * 4;
    return errors;
  }
  if (value.kind !== "mesh") return [`${label}.kind must be primitive or mesh.`];
  const validPositions = finiteNumberSequence(value.positions);
  if (!validPositions || (value.positions as ArrayLike<number>)?.length < 9 || (value.positions as ArrayLike<number>).length % 3 !== 0) errors.push(`${label}.positions must contain at least three finite XYZ vertices.`);
  const positions = validPositions ? (value.positions as ArrayLike<number>).length : 0;
  const vertices = positions / 3;
  budget.geometryValues += positions;
  budget.allocationBytes += positions * 4;
  if (value.indices !== undefined) {
    if (!finiteNumberSequence(value.indices, "index") || Array.prototype.some.call(value.indices, (entry: unknown) => !Number.isSafeInteger(entry) || (entry as number) < 0 || (entry as number) >= vertices)) errors.push(`${label}.indices must reference existing vertices with non-negative integers.`);
    else { budget.geometryValues += (value.indices as ArrayLike<number>).length; budget.allocationBytes += (value.indices as ArrayLike<number>).length * 4; }
  }
  if (value.normals !== undefined) {
    if (!finiteNumberSequence(value.normals) || (value.normals as ArrayLike<number>).length !== positions) errors.push(`${label}.normals must contain one finite XYZ normal per vertex.`);
    else { budget.geometryValues += (value.normals as ArrayLike<number>).length; budget.allocationBytes += (value.normals as ArrayLike<number>).length * 4; }
  }
  if (value.uvs !== undefined) {
    if (!finiteNumberSequence(value.uvs) || (value.uvs as ArrayLike<number>).length !== vertices * 2) errors.push(`${label}.uvs must contain one finite UV pair per vertex.`);
    else { budget.geometryValues += (value.uvs as ArrayLike<number>).length; budget.allocationBytes += (value.uvs as ArrayLike<number>).length * 4; }
  }
  if (value.groups !== undefined) {
    if (!Array.isArray(value.groups)) errors.push(`${label}.groups must be an array when present.`);
    else value.groups.forEach((group, index) => {
      if (!object(group) || !nonNegativeInteger(group.start) || !nonNegativeInteger(group.count) || !nonNegativeInteger(group.materialIndex, MAX_ASSET_MATERIALS)) errors.push(`${label}.groups[${index}] must contain bounded start, count, and materialIndex integers.`);
    });
  }
  return errors;
}

function materialErrors(value: unknown, label: string) {
  const errors: string[] = [];
  if (!object(value)) return [`${label} must be a material object.`];
  if (!boundedId(value.id)) errors.push(`${label}.id must be a bounded non-empty identifier.`);
  if (!boundedText(value.name, 2_000)) errors.push(`${label}.name must be a bounded non-empty string.`);
  if (!["standard", "basic", "phong", "unknown"].includes(String(value.type))) errors.push(`${label}.type is not supported.`);
  if (typeof value.color !== "string" || value.color.length > 200) errors.push(`${label}.color must be a bounded string.`);
  if (value.emissive !== undefined && (typeof value.emissive !== "string" || value.emissive.length > 200)) errors.push(`${label}.emissive must be a bounded string when present.`);
  for (const field of ["roughness", "metalness"] as const) if (value[field] !== undefined && (typeof value[field] !== "number" || !Number.isFinite(value[field]) || value[field] < 0 || value[field] > 1)) errors.push(`${label}.${field} must be between zero and one.`);
  if (typeof value.opacity !== "number" || !Number.isFinite(value.opacity) || value.opacity < 0 || value.opacity > 1) errors.push(`${label}.opacity must be between zero and one.`);
  if (typeof value.doubleSided !== "boolean") errors.push(`${label}.doubleSided must be boolean.`);
  if (value.wireframe !== undefined && typeof value.wireframe !== "boolean") errors.push(`${label}.wireframe must be boolean when present.`);
  if (value.maps !== undefined) {
    if (!Array.isArray(value.maps) || value.maps.length > 32) errors.push(`${label}.maps must contain at most 32 entries.`);
    else value.maps.forEach((map, index) => {
      const mapLabel = `${label}.maps[${index}]`;
      if (!object(map)) { errors.push(`${mapLabel} must be an object.`); return; }
      if (!boundedId(map.slot, 200)) errors.push(`${mapLabel}.slot must be a bounded non-empty identifier.`);
      for (const field of ["name", "sourceRef", "resourceId"] as const) if (map[field] !== undefined && !boundedId(map[field], field === "name" ? 2_000 : 10_000)) errors.push(`${mapLabel}.${field} is invalid.`);
      if (map.wrap !== undefined && map.wrap !== "clamp" && map.wrap !== "repeat") errors.push(`${mapLabel}.wrap must be clamp or repeat.`);
      if (map.repeat !== undefined && !finiteVec2(map.repeat)) errors.push(`${mapLabel}.repeat must be a finite UV pair.`);
      if (map.offset !== undefined && !finiteVec2(map.offset)) errors.push(`${mapLabel}.offset must be a finite UV pair.`);
      if (map.rotation !== undefined && (typeof map.rotation !== "number" || !Number.isFinite(map.rotation))) errors.push(`${mapLabel}.rotation must be finite.`);
      if (map.flipY !== undefined && typeof map.flipY !== "boolean") errors.push(`${mapLabel}.flipY must be boolean.`);
    });
  }
  return errors;
}

function feedbackNodeErrors(value: unknown, label: string, budget: AssetValidationBudget) {
  const errors: string[] = [];
  if (!object(value)) return [`${label} must be a node object.`];
  if (!boundedId(value.id) || !boundedText(value.name, 2_000) || !["group", "mesh", "line", "points"].includes(String(value.type))) errors.push(`${label} requires valid id, name, and type fields.`);
  if (value.parentId !== undefined && !boundedId(value.parentId)) errors.push(`${label}.parentId is invalid.`);
  if (!finiteVec3(value.position) || !finiteVec3(value.rotation) || !finiteVec3(value.scale)
    || (finiteVec3(value.scale) && (value.scale as number[]).some((component) => Math.abs(component) < 1e-8))) errors.push(`${label} transform is invalid.`);
  if (typeof value.visible !== "boolean" || !Array.isArray(value.materialIds) || value.materialIds.some((id) => !boundedId(id))) errors.push(`${label} requires visible and materialIds fields.`);
  if (value.geometry !== undefined && value.geometryId !== undefined) errors.push(`${label} must use only one geometry encoding.`);
  if (value.geometry !== undefined) errors.push(...geometryErrors(value.geometry, `${label}.geometry`, budget));
  if (value.geometryId !== undefined && !boundedId(value.geometryId)) errors.push(`${label}.geometryId is invalid.`);
  if (value.sourceRef !== undefined && !boundedId(value.sourceRef, 10_000)) errors.push(`${label}.sourceRef is invalid.`);
  if (value.instances !== undefined && value.instanceData !== undefined) errors.push(`${label} must use only one instance encoding.`);
  if (value.instances !== undefined) {
    if (!Array.isArray(value.instances) || value.instances.length > MAX_INSTANCE_COUNT
      || value.instances.some((matrix) => !Array.isArray(matrix) || matrix.length !== 16 || matrix.some((entry) => typeof entry !== "number" || !Number.isFinite(entry)))) errors.push(`${label}.instances is invalid.`);
    else { budget.instances += value.instances.length; budget.allocationBytes += value.instances.length * 16 * 4; }
  }
  if (value.instanceData !== undefined) {
    errors.push(...assetInstanceErrors(value.instanceData, 64 * 1024 * 1024, `${label}.instanceData`));
    if (object(value.instanceData) && nonNegativeInteger(value.instanceData.count, MAX_INSTANCE_COUNT)) {
      budget.instances += value.instanceData.count as number;
      budget.allocationBytes += (value.instanceData.transforms instanceof Float32Array ? value.instanceData.transforms.byteLength : 0)
        + (value.instanceData.colors instanceof Float32Array || value.instanceData.colors instanceof Uint8Array ? value.instanceData.colors.byteLength : 0)
        + (value.instanceData.stableIds instanceof Uint32Array ? value.instanceData.stableIds.byteLength : 0);
    }
  }
  budget.nodes += 1;
  return errors;
}

function assetFeedbackErrors(value: unknown, label: string, budget: AssetValidationBudget) {
  const errors: string[] = [];
  if (!object(value)) return [`${label} must be a feedback object.`];
  if (!["unreviewed", "needs-change", "question", "approved"].includes(String(value.status))) errors.push(`${label}.status is invalid.`);
  if (typeof value.summary !== "string" || value.summary.length > 100_000) errors.push(`${label}.summary must be a bounded string.`);
  if (!Array.isArray(value.annotations) || value.annotations.length > 100_000) errors.push(`${label}.annotations must be a bounded array.`);
  else value.annotations.forEach((annotation, index) => {
    const annotationLabel = `${label}.annotations[${index}]`;
    if (!object(annotation)) { errors.push(`${annotationLabel} must be an object.`); return; }
    if (!boundedId(annotation.id) || typeof annotation.body !== "string" || annotation.body.length > 100_000 || !boundedText(annotation.category, 2_000)) errors.push(`${annotationLabel} requires bounded id, body, and category fields.`);
    if (!["low", "medium", "high", "blocker"].includes(String(annotation.priority))) errors.push(`${annotationLabel}.priority is invalid.`);
    if (!object(annotation.target) || !["asset", "component", "geometry", "material"].includes(String(annotation.target.scope))) errors.push(`${annotationLabel}.target is invalid.`);
    else for (const field of ["nodeId", "materialId"] as const) if (annotation.target[field] !== undefined && !boundedId(annotation.target[field])) errors.push(`${annotationLabel}.target.${field} is invalid.`);
    if (annotation.anchor !== undefined) {
      if (!object(annotation.anchor) || !boundedId(annotation.anchor.nodeId) || !finiteVec3(annotation.anchor.localPosition)
        || (annotation.anchor.instanceId !== undefined && !nonNegativeInteger(annotation.anchor.instanceId, 0xffff_ffff))
        || (annotation.anchor.localNormal !== undefined && !finiteVec3(annotation.anchor.localNormal))
        || (annotation.anchor.uv !== undefined && !finiteVec2(annotation.anchor.uv))) errors.push(`${annotationLabel}.anchor is invalid.`);
    }
    if (!boundedText(annotation.createdAt, 2_000) || typeof annotation.resolved !== "boolean") errors.push(`${annotationLabel} requires createdAt and resolved fields.`);
    if (annotation.author !== undefined && (typeof annotation.author !== "string" || annotation.author.length > 2_000)) errors.push(`${annotationLabel}.author must be a bounded string.`);
  });
  if (!Array.isArray(value.modifications) || value.modifications.length > 100_000) errors.push(`${label}.modifications must be a bounded array.`);
  else value.modifications.forEach((modification, index) => {
    const modificationLabel = `${label}.modifications[${index}]`;
    if (!object(modification) || !boundedId(modification.id) || !["transform", "delete", "add"].includes(String(modification.action))) { errors.push(`${modificationLabel} is invalid.`); return; }
    if (modification.action === "add") {
      errors.push(...feedbackNodeErrors(modification.node, `${modificationLabel}.node`, budget));
      if (modification.material !== undefined) { errors.push(...materialErrors(modification.material, `${modificationLabel}.material`)); budget.materials += 1; }
      return;
    }
    const part = modification.part;
    if (!object(part) || !boundedId(part.id) || !boundedText(part.name, 2_000) || (part.sourceRef !== undefined && !boundedId(part.sourceRef, 10_000))) errors.push(`${modificationLabel}.part is invalid.`);
    if (modification.action === "transform" && (!finiteTransform(modification.before) || !finiteTransform(modification.after))) errors.push(`${modificationLabel} requires valid before and after transforms.`);
    if (modification.action === "delete" && modification.removedNodes !== undefined) {
      if (!Array.isArray(modification.removedNodes) || modification.removedNodes.length > MAX_ASSET_NODES) errors.push(`${modificationLabel}.removedNodes must be a bounded array.`);
      else modification.removedNodes.forEach((removed, removedIndex) => {
        if (!object(removed) || !nonNegativeInteger(removed.index, MAX_ASSET_NODES)) errors.push(`${modificationLabel}.removedNodes[${removedIndex}] is invalid.`);
        else errors.push(...feedbackNodeErrors(removed.node, `${modificationLabel}.removedNodes[${removedIndex}].node`, budget));
      });
    }
  });
  return errors;
}

function assetHierarchyErrors(nodes: Record<string, unknown>[], label: string) {
  const errors: string[] = [];
  const ids = new Set<string>();
  const parents = new Map<string, string | undefined>();
  nodes.forEach((node, index) => {
    if (!boundedId(node.id)) return;
    const id = node.id as string;
    if (ids.has(id)) errors.push(`${label} contains duplicate node id "${id}".`);
    ids.add(id);
    parents.set(id, typeof node.parentId === "string" ? node.parentId : undefined);
    if (node.parentId !== undefined && !boundedId(node.parentId)) errors.push(`${label}[${index}].parentId must be a bounded non-empty identifier.`);
  });
  parents.forEach((parent, id) => { if (parent && !ids.has(parent)) errors.push(`${label} node "${id}" references missing parent "${parent}".`); });
  const depths = new Map<string, number>();
  for (const id of ids) {
    const path: string[] = [];
    const active = new Set<string>();
    let current: string | undefined = id;
    while (current && ids.has(current) && !depths.has(current)) {
      if (active.has(current)) { errors.push(`${label} contains a node hierarchy cycle at "${current}".`); current = undefined; break; }
      active.add(current); path.push(current); current = parents.get(current);
    }
    let depth = current && depths.has(current) ? depths.get(current)! : 0;
    for (let index = path.length - 1; index >= 0; index -= 1) {
      depth += 1;
      if (depth > MAX_ASSET_HIERARCHY_DEPTH) { errors.push(`${label} exceeds the maximum hierarchy depth of ${MAX_ASSET_HIERARCHY_DEPTH}.`); break; }
      depths.set(path[index], depth);
    }
  }
  return errors;
}

function reviewAssetErrors(value: unknown, label: string, budget: AssetValidationBudget, instanceMaxBytes = 64 * 1024 * 1024) {
  const errors: string[] = [];
  if (!object(value)) return [`${label} must be an object.`];
  if (!boundedId(value.id)) errors.push(`${label}.id must be a bounded non-empty identifier.`);
  if (!boundedText(value.name, 2_000)) errors.push(`${label}.name must be a bounded non-empty string.`);
  for (const field of ["sourceRef", "category"] as const) if (value[field] !== undefined && !boundedId(value[field], 10_000)) errors.push(`${label}.${field} is invalid.`);
  if (!Array.isArray(value.tags) || value.tags.length > 1_000 || value.tags.some((tag) => typeof tag !== "string" || tag.length > 2_000)) errors.push(`${label}.tags must contain bounded strings.`);
  if (value.sourceTransform !== undefined && !finiteTransform(value.sourceTransform)) errors.push(`${label}.sourceTransform must be finite and invertible.`);
  if (value.animations !== undefined && (!Array.isArray(value.animations) || value.animations.some((animation) => !boundedId(animation, 2_000)))) errors.push(`${label}.animations must contain bounded identifiers.`);
  if (value.stream !== undefined) errors.push(...assetStreamErrors(value.stream, `${label}.stream`));

  const geometries = value.geometries === undefined ? [] : Array.isArray(value.geometries) ? value.geometries : undefined;
  if (!geometries) errors.push(`${label}.geometries must be an array when present.`);
  const geometryIds = new Set<string>();
  (geometries ?? []).forEach((definition, index) => {
    const geometryLabel = `${label}.geometries[${index}]`;
    if (!object(definition)) { errors.push(`${geometryLabel} must be an object.`); return; }
    if (!boundedId(definition.id)) errors.push(`${geometryLabel}.id must be a bounded non-empty identifier.`);
    else if (geometryIds.has(definition.id as string)) errors.push(`${label}.geometries contains duplicate id "${definition.id}".`);
    else geometryIds.add(definition.id as string);
    if (definition.name !== undefined && !boundedText(definition.name, 2_000)) errors.push(`${geometryLabel}.name must be bounded and non-empty when present.`);
    errors.push(...geometryErrors(definition.geometry, `${geometryLabel}.geometry`, budget));
  });

  const materials = Array.isArray(value.materials) ? value.materials : undefined;
  if (!materials) errors.push(`${label}.materials must be an array.`);
  const materialIds = new Set<string>();
  (materials ?? []).forEach((material, index) => {
    errors.push(...materialErrors(material, `${label}.materials[${index}]`));
    if (object(material) && boundedId(material.id)) {
      if (materialIds.has(material.id as string)) errors.push(`${label}.materials contains duplicate id "${material.id}".`);
      else materialIds.add(material.id as string);
    }
  });

  const nodes = Array.isArray(value.nodes) ? value.nodes : undefined;
  if (!nodes) errors.push(`${label}.nodes must be an array.`);
  const nodeRecords = (nodes ?? []).filter(object);
  (nodes ?? []).forEach((node, index) => {
    const nodeLabel = `${label}.nodes[${index}]`;
    if (!object(node)) { errors.push(`${nodeLabel} must be an object.`); return; }
    if (!boundedId(node.id)) errors.push(`${nodeLabel}.id must be a bounded non-empty identifier.`);
    if (!boundedText(node.name, 2_000)) errors.push(`${nodeLabel}.name must be a bounded non-empty string.`);
    if (!["group", "mesh", "line", "points"].includes(String(node.type))) errors.push(`${nodeLabel}.type is not supported.`);
    if (!finiteVec3(node.position) || !finiteVec3(node.rotation) || !finiteVec3(node.scale) || (finiteVec3(node.scale) && (node.scale as number[]).some((component) => Math.abs(component) < 1e-8))) errors.push(`${nodeLabel} transform must contain finite position/rotation and invertible scale vectors.`);
    if (typeof node.visible !== "boolean") errors.push(`${nodeLabel}.visible must be boolean.`);
    if (node.geometry !== undefined && node.geometryId !== undefined) errors.push(`${nodeLabel} must use only one geometry encoding.`);
    if (node.geometry !== undefined) errors.push(...geometryErrors(node.geometry, `${nodeLabel}.geometry`, budget));
    if (node.geometryId !== undefined && (!boundedId(node.geometryId) || !geometryIds.has(node.geometryId as string))) errors.push(`${nodeLabel}.geometryId must reference a declared geometry.`);
    if (!Array.isArray(node.materialIds) || node.materialIds.some((id) => !boundedId(id) || !materialIds.has(id))) errors.push(`${nodeLabel}.materialIds must reference declared materials.`);
    if (node.sourceRef !== undefined && !boundedId(node.sourceRef, 10_000)) errors.push(`${nodeLabel}.sourceRef is invalid.`);
    if (node.instances !== undefined && node.instanceData !== undefined) errors.push(`${nodeLabel} must use only one instance encoding.`);
    if (node.instances !== undefined) {
      if (!Array.isArray(node.instances) || node.instances.length > MAX_INSTANCE_COUNT || node.instances.some((matrix) => !Array.isArray(matrix) || matrix.length !== 16 || matrix.some((entry) => typeof entry !== "number" || !Number.isFinite(entry)))) errors.push(`${nodeLabel}.instances must contain at most ${MAX_INSTANCE_COUNT} finite 4x4 matrices.`);
      else { budget.instances += node.instances.length; budget.allocationBytes += node.instances.length * 16 * 4; }
    }
    if (node.instanceData !== undefined) {
      errors.push(...assetInstanceErrors(node.instanceData, instanceMaxBytes, `${nodeLabel}.instanceData`));
      if (object(node.instanceData) && nonNegativeInteger(node.instanceData.count, MAX_INSTANCE_COUNT)) {
        budget.instances += node.instanceData.count as number;
        budget.allocationBytes += (node.instanceData.transforms instanceof Float32Array ? node.instanceData.transforms.byteLength : 0)
          + (node.instanceData.colors instanceof Float32Array || node.instanceData.colors instanceof Uint8Array ? node.instanceData.colors.byteLength : 0)
          + (node.instanceData.stableIds instanceof Uint32Array ? node.instanceData.stableIds.byteLength : 0);
      }
    }
  });
  errors.push(...assetHierarchyErrors(nodeRecords, `${label}.nodes`));
  errors.push(...assetFeedbackErrors(value.feedback, `${label}.feedback`, budget));

  budget.nodes += nodes?.length ?? 0;
  budget.materials += materials?.length ?? 0;
  return errors;
}

function sceneDocumentErrors(value: unknown) {
  const errors: string[] = [];
  if (!object(value)) return ["Scene document must be an object."];
  if (value.schema !== SCENE_ACTORS_SCHEMA) errors.push(`scene.schema must be ${SCENE_ACTORS_SCHEMA}.`);
  if (!Array.isArray(value.actors)) errors.push("scene.actors must be an array.");
  else {
    if (value.actors.length > MAX_SCENE_ACTORS) errors.push(`scene.actors exceeds the ${MAX_SCENE_ACTORS} item safety limit.`);
    const actorIds = new Set<string>();
    value.actors.forEach((actor, index) => {
      const label = `scene.actors[${index}]`;
      if (!object(actor)) { errors.push(`${label} must be an object.`); return; }
      if (!boundedId(actor.actorId)) errors.push(`${label}.actorId must be a bounded non-empty identifier.`);
      else if (actorIds.has(actor.actorId as string)) errors.push(`scene.actors contains duplicate actorId "${actor.actorId}".`);
      else actorIds.add(actor.actorId as string);
      if (!boundedId(actor.assetId) || !boundedText(actor.name, 2_000) || !boundedId(actor.sourceRef, 10_000) || !boundedText(actor.category, 2_000)) errors.push(`${label} requires bounded assetId, name, sourceRef, and category fields.`);
      if (!finiteTransform(actor.transform)) errors.push(`${label}.transform must be finite and invertible.`);
      if (!finiteBounds(actor.bounds)) errors.push(`${label}.bounds must contain finite center and non-negative size vectors.`);
      if (actor.visible !== undefined && typeof actor.visible !== "boolean") errors.push(`${label}.visible must be boolean when present.`);
    });
  }
  errors.push(...validateSceneOwnership(value));
  if (value.navigationSequences !== undefined) {
    if (!Array.isArray(value.navigationSequences)) errors.push("scene.navigationSequences must be an array when present.");
    else {
      if (value.navigationSequences.length > MAX_NAVIGATION_SEQUENCES) errors.push(`scene.navigationSequences exceeds the ${MAX_NAVIGATION_SEQUENCES} item safety limit.`);
      let stops = 0; let segments = 0; let points = 0;
      const sequenceIds = new Set<string>();
      value.navigationSequences.forEach((sequence, index) => {
        if (object(sequence) && typeof sequence.id === "string") {
          if (sequenceIds.has(sequence.id)) errors.push(`scene.navigationSequences contains duplicate id "${sequence.id}".`);
          else sequenceIds.add(sequence.id);
        }
        const counts = validateNavigationSequence(sequence, index, errors);
        stops += counts.stops; segments += counts.segments; points += counts.points;
      });
      if (stops > MAX_NAVIGATION_STOPS) errors.push(`navigation stops exceed the ${MAX_NAVIGATION_STOPS} item safety limit.`);
      if (segments > MAX_NAVIGATION_SEGMENTS) errors.push(`navigation segments exceed the ${MAX_NAVIGATION_SEGMENTS} item safety limit.`);
      if (points > MAX_NAVIGATION_POINTS) errors.push(`navigation curve points exceed the ${MAX_NAVIGATION_POINTS} item safety limit.`);
    }
  }
  return errors;
}

export function validateDiscovery(value: unknown, url: string): ValidationResult<SpatialReviewDiscovery> {
  try { return { ok: true, value: normalizeSpatialReviewDiscovery(value, url) }; } catch (error) { return { ok: false, errors: [error instanceof Error ? error.message : "Invalid discovery document"] }; }
}

export function validateSceneDocument(value: unknown): ValidationResult<SpatialReviewScene> {
  const errors = sceneDocumentErrors(value);
  return errors.length ? { ok: false, errors } : { ok: true, value: value as SpatialReviewScene };
}

export function validateAssetDocument(value: unknown): ValidationResult<AssetReviewDocument3D> {
  const errors: string[] = [];
  if (!object(value)) errors.push("Asset document must be an object.");
  else {
    if (value.schema !== ASSET_REVIEW_SCHEMA) errors.push(`schema must be ${ASSET_REVIEW_SCHEMA}.`);
    if (!boundedId(value.id) || !boundedText(value.name, 2_000)) errors.push("id and name must be bounded non-empty strings.");
    if (value.units !== "m") errors.push("units must be m.");
    if (value.source !== undefined) {
      if (!object(value.source)) errors.push("source must be an object when present.");
      else for (const field of ["label", "url", "importedAt", "generator"] as const) {
        if (value.source[field] !== undefined && (typeof value.source[field] !== "string" || value.source[field].length > 10_000)) errors.push(`source.${field} must be a bounded string when present.`);
      }
    }
    if (!Array.isArray(value.assets)) errors.push("assets must be an array.");
    else if (value.assets.length > MAX_ASSETS) errors.push(`assets exceeds the ${MAX_ASSETS} item safety limit.`);
    else {
      const ids = new Set<string>();
      const budget = emptyAssetValidationBudget();
      value.assets.forEach((asset, assetIndex) => {
        errors.push(...reviewAssetErrors(asset, `assets[${assetIndex}]`, budget));
        if (object(asset) && boundedId(asset.id)) {
          if (ids.has(asset.id as string)) errors.push(`assets contains duplicate id "${asset.id}".`);
          else ids.add(asset.id as string);
        }
      });
      if (budget.nodes > MAX_ASSET_NODES) errors.push(`asset nodes exceed the ${MAX_ASSET_NODES} item safety limit.`);
      if (budget.materials > MAX_ASSET_MATERIALS) errors.push(`asset materials exceed the ${MAX_ASSET_MATERIALS} item safety limit.`);
      if (budget.geometries > MAX_ASSET_GEOMETRIES) errors.push(`asset geometries exceed the ${MAX_ASSET_GEOMETRIES} item safety limit.`);
      if (budget.geometryValues > MAX_ASSET_GEOMETRY_VALUES) errors.push(`asset geometry values exceed the ${MAX_ASSET_GEOMETRY_VALUES} item safety limit.`);
      if (budget.instances > MAX_INSTANCE_COUNT) errors.push(`asset instances exceed the ${MAX_INSTANCE_COUNT} item safety limit.`);
      if (budget.allocationBytes > MAX_ASSET_ALLOCATION_BYTES) errors.push(`asset render allocations exceed the ${MAX_ASSET_ALLOCATION_BYTES}-byte safety limit.`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: value as AssetReviewDocument3D };
}

export function validateReviewIndex(value: unknown): ValidationResult<SpatialReviewIndex> {
  const errors: string[] = [];
  if (!object(value)) errors.push("Review index must be an object.");
  else {
    if (value.schema !== SPATIAL_REVIEW_INDEX_SCHEMA) errors.push(`schema must be ${SPATIAL_REVIEW_INDEX_SCHEMA}.`);
    if (!boundedId(value.buildId, 200)) errors.push("buildId must be a bounded non-empty identifier.");
    if (!boundedText(value.generatedAt, 2_000)) errors.push("generatedAt must be a bounded non-empty string.");
    errors.push(...sceneDocumentErrors(value.scene));
    const assets = object(value.assetCatalog) ? value.assetCatalog.assets : undefined;
    if (!Array.isArray(assets)) errors.push("assetCatalog.assets must be an array.");
    else {
      const assetResult = validateAssetDocument(value.assetCatalog);
      if (!assetResult.ok) errors.push(...assetResult.errors.map((error) => `assetCatalog.${error}`));
      else if (object(value.scene) && Array.isArray(value.scene.actors)) {
        const assetIds = new Set(assetResult.value.assets.map((asset) => asset.id));
        value.scene.actors.forEach((actor, index) => {
          if (object(actor) && typeof actor.assetId === "string" && !assetIds.has(actor.assetId)) errors.push(`scene.actors[${index}].assetId does not reference assetCatalog.`);
        });
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: value as SpatialReviewIndex };
}

export function validateSpatialReviewAssetRequest(value: unknown): ValidationResult<SpatialReviewAssetRequest> {
  const errors: string[] = [];
  if (!object(value)) errors.push("Asset request must be an object.");
  else {
    if (value.type !== SPATIAL_REVIEW_ASSET_REQUEST) errors.push(`type must be ${SPATIAL_REVIEW_ASSET_REQUEST}.`);
    for (const field of ["requestId", "buildId", "assetId"] as const) if (!boundedId(value[field], field === "assetId" ? 500 : 200)) errors.push(`${field} is invalid.`);
    if (value.profile !== "scene" && value.profile !== "review") errors.push("profile must be scene or review.");
    if (value.stream !== undefined) {
      if (!object(value.stream)) errors.push("stream must be an object.");
      else {
        if (value.stream.capability !== SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY) errors.push(`stream.capability must be ${SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY}.`);
        if (!boundedId(value.stream.representationId, 200)) errors.push("stream.representationId is invalid.");
        if (!nonNegativeInteger(value.stream.maxBytes, MAX_STREAM_ESTIMATED_BYTES) || value.stream.maxBytes === 0) errors.push("stream.maxBytes must be a positive bounded integer.");
        if (!["interactive", "visible", "background"].includes(String(value.stream.priority))) errors.push("stream.priority is invalid.");
        if (value.stream.knownRevision !== undefined && !boundedId(value.stream.knownRevision, MAX_REVISION_LENGTH)) errors.push("stream.knownRevision is invalid.");
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: value as SpatialReviewAssetRequest };
}

export function validateSpatialReviewAssetResponse(value: unknown, maxBytes = 64 * 1024 * 1024): ValidationResult<SpatialReviewAssetResponse> {
  const errors: string[] = [];
  if (!object(value)) errors.push("Asset response must be an object.");
  else {
    if (value.type !== SPATIAL_REVIEW_ASSET_RESPONSE) errors.push(`type must be ${SPATIAL_REVIEW_ASSET_RESPONSE}.`);
    for (const field of ["requestId", "buildId", "assetId"] as const) if (!boundedId(value[field], field === "assetId" ? 500 : 200)) errors.push(`${field} is invalid.`);
    if (value.profile !== "scene" && value.profile !== "review") errors.push("profile must be scene or review.");
    if (value.representationId !== undefined && !boundedId(value.representationId, 200)) errors.push("representationId is invalid.");
    if (value.revision !== undefined && !boundedId(value.revision, MAX_REVISION_LENGTH)) errors.push("revision is invalid.");
    if ((value.representationId === undefined) !== (value.revision === undefined)) errors.push("representationId and revision must be supplied together.");
    if (value.ok === true && value.notModified === true) {
      if (!boundedId(value.representationId, 200) || !boundedId(value.revision, MAX_REVISION_LENGTH)) errors.push("A notModified response requires representationId and revision.");
      if (value.asset !== undefined) errors.push("A notModified response must not include an asset.");
    } else if (value.ok === true) {
      if (!object(value.asset)) errors.push("A successful response must include an asset.");
      else {
        const asset = value.asset;
        try { measureSpatialReviewTransferBytes(asset, maxBytes); }
        catch (error) { errors.push(error instanceof Error ? error.message : "asset exceeds the negotiated transfer budget."); }
        if (asset.id !== value.assetId) errors.push("asset.id must match assetId.");
        const budget = emptyAssetValidationBudget();
        errors.push(...reviewAssetErrors(asset, "asset", budget, maxBytes));
        if (budget.nodes > MAX_ASSET_NODES || budget.materials > MAX_ASSET_MATERIALS || budget.geometries > MAX_ASSET_GEOMETRIES
          || budget.geometryValues > MAX_ASSET_GEOMETRY_VALUES || budget.instances > MAX_INSTANCE_COUNT
          || budget.allocationBytes > MAX_ASSET_ALLOCATION_BYTES) errors.push("asset exceeds structural safety limits.");
      }
    } else if (value.ok === false) {
      if (!["not-found", "too-large", "unavailable", "busy", "cancelled"].includes(String(value.error))) errors.push("error is invalid.");
      if (value.retryAfterMs !== undefined && (!nonNegativeInteger(value.retryAfterMs, 60_000) || value.error !== "busy")) errors.push("retryAfterMs is allowed only for busy responses and must be at most 60000.");
    } else errors.push("ok must be boolean.");
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: value as SpatialReviewAssetResponse };
}

export function validateSpatialReviewSourceStatus(value: unknown): ValidationResult<SpatialReviewSourceStatusMessage> {
  const errors: string[] = [];
  if (!object(value)) errors.push("Source status must be an object.");
  else {
    if (value.type !== SPATIAL_REVIEW_SOURCE_STATUS) errors.push(`type must be ${SPATIAL_REVIEW_SOURCE_STATUS}.`);
    if (!boundedId(value.buildId, 200) || !boundedId(value.catalogRevision, MAX_REVISION_LENGTH)) errors.push("buildId and catalogRevision must be bounded identifiers.");
    if (!["booting", "catalog-ready", "streaming", "complete", "error"].includes(String(value.phase))) errors.push("phase is invalid.");
    for (const field of ["expectedActors", "readyActors", "activeRequests"] as const) if (value[field] !== undefined && !nonNegativeInteger(value[field], 1_000_000)) errors.push(`${field} must be a bounded non-negative integer.`);
    if (typeof value.expectedActors === "number" && typeof value.readyActors === "number" && value.readyActors > value.expectedActors) errors.push("readyActors must not exceed expectedActors.");
    if (value.message !== undefined && (typeof value.message !== "string" || value.message.length > 500)) errors.push("message must be at most 500 characters.");
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: value as SpatialReviewSourceStatusMessage };
}

export function validateSpatialReviewAssetProgress(value: unknown): ValidationResult<SpatialReviewAssetProgressMessage> {
  const errors: string[] = [];
  if (!object(value)) errors.push("Asset progress must be an object.");
  else {
    if (value.type !== SPATIAL_REVIEW_ASSET_PROGRESS) errors.push(`type must be ${SPATIAL_REVIEW_ASSET_PROGRESS}.`);
    for (const field of ["requestId", "buildId", "assetId", "representationId"] as const) if (!boundedId(value[field], field === "assetId" ? 500 : 200)) errors.push(`${field} is invalid.`);
    if (!["queued", "generating", "serializing"].includes(String(value.phase))) errors.push("phase is invalid.");
    if (value.completed !== undefined && (typeof value.completed !== "number" || !Number.isFinite(value.completed) || value.completed < 0)) errors.push("completed must be finite and non-negative.");
    if (value.total !== undefined && (typeof value.total !== "number" || !Number.isFinite(value.total) || value.total <= 0)) errors.push("total must be finite and positive.");
    if (typeof value.completed === "number" && typeof value.total === "number" && value.completed > value.total) errors.push("completed must not exceed total.");
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: value as SpatialReviewAssetProgressMessage };
}

export function validateSpatialReviewAssetCancel(value: unknown): ValidationResult<SpatialReviewAssetCancelMessage> {
  const errors: string[] = [];
  if (!object(value)) errors.push("Asset cancellation must be an object.");
  else {
    if (value.type !== SPATIAL_REVIEW_ASSET_CANCEL) errors.push(`type must be ${SPATIAL_REVIEW_ASSET_CANCEL}.`);
    if (!boundedId(value.requestId, 200) || !boundedId(value.buildId, 200)) errors.push("requestId and buildId must be bounded identifiers.");
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: value as SpatialReviewAssetCancelMessage };
}
