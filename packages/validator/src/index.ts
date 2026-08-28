import { ASSET_REVIEW_SCHEMA, SPATIAL_REVIEW_INDEX_SCHEMA, normalizeSpatialReviewDiscovery, validateSceneOwnership, type AssetReviewDocument3D, type SpatialReviewDiscovery, type SpatialReviewIndex } from "@alterno-dev/spatial-review-protocol";

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finiteVec3 = (value: unknown) => Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));

const MAX_NAVIGATION_SEQUENCES = 200;
const MAX_NAVIGATION_STOPS = 5_000;
const MAX_NAVIGATION_SEGMENTS = 5_000;
const MAX_NAVIGATION_POINTS = 50_000;

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
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: value as SpatialReviewIndex };
}
