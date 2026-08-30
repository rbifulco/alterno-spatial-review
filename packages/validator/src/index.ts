import {
  ASSET_REVIEW_SCHEMA,
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
  type SpatialReviewSourceStatusMessage,
} from "@alterno-dev/spatial-review-protocol";

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finiteVec3 = (value: unknown) => Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));

const MAX_NAVIGATION_SEQUENCES = 200;
const MAX_NAVIGATION_STOPS = 5_000;
const MAX_NAVIGATION_SEGMENTS = 5_000;
const MAX_NAVIGATION_POINTS = 50_000;
const MAX_STREAM_REPRESENTATIONS = 32;
const MAX_STREAM_ESTIMATED_BYTES = 1024 * 1024 * 1024;
const MAX_INSTANCE_COUNT = 100_000;
const MAX_REVISION_LENGTH = 200;

const boundedId = (value: unknown, max = 500) => typeof value === "string" && value.length > 0 && value.length <= max;
const nonNegativeInteger = (value: unknown, max = Number.MAX_SAFE_INTEGER) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;

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

export function validateDiscovery(value: unknown, url: string): ValidationResult<SpatialReviewDiscovery> {
  try { return { ok: true, value: normalizeSpatialReviewDiscovery(value, url) }; } catch (error) { return { ok: false, errors: [error instanceof Error ? error.message : "Invalid discovery document"] }; }
}

export function validateAssetDocument(value: unknown): ValidationResult<AssetReviewDocument3D> {
  const errors: string[] = [];
  if (!object(value)) errors.push("Asset document must be an object.");
  else {
    if (value.schema !== ASSET_REVIEW_SCHEMA) errors.push(`schema must be ${ASSET_REVIEW_SCHEMA}.`);
    if (!Array.isArray(value.assets)) errors.push("assets must be an array.");
    else if (value.assets.length > 2_000) errors.push("assets exceeds the 2,000 item safety limit.");
    else value.assets.forEach((asset, assetIndex) => {
      if (!object(asset)) { errors.push(`assets[${assetIndex}] must be an object.`); return; }
      if (asset.stream !== undefined) errors.push(...assetStreamErrors(asset.stream, `assets[${assetIndex}].stream`));
      if (!Array.isArray(asset.nodes)) return;
      asset.nodes.forEach((node, nodeIndex) => {
        if (!object(node)) return;
        if (node.instances !== undefined && node.instanceData !== undefined) errors.push(`assets[${assetIndex}].nodes[${nodeIndex}] must use only one instance encoding.`);
        if (node.instanceData !== undefined) errors.push(...assetInstanceErrors(node.instanceData, 64 * 1024 * 1024, `assets[${assetIndex}].nodes[${nodeIndex}].instanceData`));
      });
    });
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: value as AssetReviewDocument3D };
}

export function validateReviewIndex(value: unknown): ValidationResult<SpatialReviewIndex> {
  const errors: string[] = [];
  if (!object(value)) errors.push("Review index must be an object.");
  else {
    if (value.schema !== SPATIAL_REVIEW_INDEX_SCHEMA) errors.push(`schema must be ${SPATIAL_REVIEW_INDEX_SCHEMA}.`);
    if (object(value.scene)) errors.push(...validateSceneOwnership(value.scene));
    if (!object(value.scene) || !Array.isArray(value.scene.actors)) errors.push("scene.actors must be an array.");
    else if (value.scene.navigationSequences !== undefined) {
      if (!Array.isArray(value.scene.navigationSequences)) errors.push("scene.navigationSequences must be an array when present.");
      else {
        if (value.scene.navigationSequences.length > MAX_NAVIGATION_SEQUENCES) errors.push(`scene.navigationSequences exceeds the ${MAX_NAVIGATION_SEQUENCES} item safety limit.`);
        let stops = 0;
        let segments = 0;
        let points = 0;
        const sequenceIds = new Set<string>();
        value.scene.navigationSequences.forEach((sequence, index) => {
          if (object(sequence) && typeof sequence.id === "string") {
            if (sequenceIds.has(sequence.id)) errors.push(`scene.navigationSequences contains duplicate id "${sequence.id}".`);
            else sequenceIds.add(sequence.id);
          }
          const counts = validateNavigationSequence(sequence, index, errors);
          stops += counts.stops;
          segments += counts.segments;
          points += counts.points;
        });
        if (stops > MAX_NAVIGATION_STOPS) errors.push(`navigation stops exceed the ${MAX_NAVIGATION_STOPS} item safety limit.`);
        if (segments > MAX_NAVIGATION_SEGMENTS) errors.push(`navigation segments exceed the ${MAX_NAVIGATION_SEGMENTS} item safety limit.`);
        if (points > MAX_NAVIGATION_POINTS) errors.push(`navigation curve points exceed the ${MAX_NAVIGATION_POINTS} item safety limit.`);
      }
    }
    const assets = object(value.assetCatalog) ? value.assetCatalog.assets : undefined;
    if (!Array.isArray(assets)) errors.push("assetCatalog.assets must be an array.");
    else {
      const assetResult = validateAssetDocument(value.assetCatalog);
      if (!assetResult.ok) errors.push(...assetResult.errors.map((error) => `assetCatalog.${error}`));
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
        if (asset.stream !== undefined) errors.push(...assetStreamErrors(asset.stream, "asset.stream"));
        if (Array.isArray(asset.nodes)) asset.nodes.forEach((node, index) => {
          if (!object(node)) return;
          if (node.instances !== undefined && node.instanceData !== undefined) errors.push(`asset.nodes[${index}] must use only one instance encoding.`);
          if (node.instanceData !== undefined) errors.push(...assetInstanceErrors(node.instanceData, maxBytes, `asset.nodes[${index}].instanceData`));
        });
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
