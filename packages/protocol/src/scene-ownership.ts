import { SPATIAL_REVIEW_ASSEMBLIES_CAPABILITY } from "./constants.js";
import type { Transform3D } from "./types.js";

export const MAX_SCENE_ASSEMBLIES = 10_000;
export const MAX_OWNED_SCENE_ACTORS = 100_000;
export const MAX_SCENE_OWNERSHIP_DEPTH = 128;

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 500;
const vector = (value: unknown): value is [number, number, number] => Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));

/** Column-major XYZ Euler matrix. No engine or runtime dependency. */
export function sceneTransformMatrix(transform: Transform3D): number[] {
  const [x, y, z] = transform.rotation.map((angle) => angle * Math.PI / 180);
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const [sx, sy, sz] = transform.scale;
  return [c * e * sx, (a * f + b * e * d) * sx, (b * f - a * e * d) * sx, 0,
    -c * f * sy, (a * e - b * f * d) * sy, (b * e + a * f * d) * sy, 0,
    d * sz, -b * c * sz, a * c * sz, 0, ...transform.position, 1];
}

export function multiplySceneMatrices(left: readonly number[], right: readonly number[]): number[] {
  return Array.from({ length: 16 }, (_, index) => {
    const row = index % 4, column = Math.floor(index / 4) * 4;
    return left[row] * right[column] + left[row + 4] * right[column + 1] + left[row + 8] * right[column + 2] + left[row + 12] * right[column + 3];
  });
}

function validTransform(value: unknown, uniform: boolean): value is Transform3D {
  if (!record(value) || !vector(value.position) || !vector(value.rotation) || !vector(value.scale)) return false;
  const scale = value.scale;
  if (scale.some((entry) => Math.abs(entry) < 1e-8)) return false;
  return !uniform || (scale[0] > 0 && scale.every((entry) => Math.abs(entry - scale[0]) <= 1e-7 * Math.max(1, Math.abs(entry))));
}

/** Validate only the additive ownership extension; legacy flat scenes stay valid.
 * Bounded iterative traversal rejects malformed graphs before consumers recurse. */
export function validateSceneOwnership(value: unknown): string[] {
  if (!record(value)) return ["Scene must be an object."];
  const actors = Array.isArray(value.actors) ? value.actors : [];
  const owns = actors.some((actor) => record(actor) && (actor.parentAssemblyId !== undefined || actor.localTransform !== undefined));
  if (value.assemblies === undefined && value.ownership === undefined && !owns) return [];
  const errors: string[] = [];
  const ownership = value.ownership;
  if (!record(ownership) || ownership.capability !== SPATIAL_REVIEW_ASSEMBLIES_CAPABILITY || !["hierarchical", "flattened"].includes(String(ownership.mode))) {
    return ["scene.ownership must explicitly advertise scene-assemblies-v1 and its mode."];
  }
  if (ownership.mode === "flattened") {
    if (value.assemblies !== undefined || owns) errors.push("A flattened scene cannot contain assemblies or parent-local ownership fields.");
    return errors;
  }
  if (!Array.isArray(value.assemblies)) return ["scene.assemblies must be an array in hierarchical mode."];
  if (value.assemblies.length > MAX_SCENE_ASSEMBLIES || actors.length > MAX_OWNED_SCENE_ACTORS) return ["Scene ownership exceeds the assembly or actor safety limit."];
  const assemblies = new Map<string, Record<string, unknown>>();
  const identifiers = new Set<string>();
  const inspect = (entry: unknown, assembly: boolean, index: number) => {
    const label = `scene.${assembly ? "assemblies" : "actors"}[${index}]`;
    if (!record(entry)) { errors.push(`${label} must be an object.`); return; }
    const key = entry[assembly ? "assemblyId" : "actorId"];
    if (!id(key)) errors.push(`${label} needs a stable non-empty ID.`);
    else if (identifiers.has(key)) errors.push(`Duplicate scene ownership ID "${key}".`);
    else { identifiers.add(key); if (assembly) assemblies.set(key, entry); }
    if (!id(entry.sourceRef)) errors.push(`${label}.sourceRef must be a stable non-empty reference.`);
    if (typeof entry.name !== "string" || !entry.name.trim()) errors.push(`${label}.name must be non-empty.`);
    if (entry.parentAssemblyId !== undefined && !id(entry.parentAssemblyId)) errors.push(`${label}.parentAssemblyId must name one assembly.`);
    if (!validTransform(entry.localTransform, assembly)) errors.push(`${label}.localTransform must be finite and invertible${assembly ? " with positive uniform scale" : ""}.`);
    if (!validTransform(entry.transform, assembly)) errors.push(`${label}.transform must be a finite world pose${assembly ? " with positive uniform scale" : ""}.`);
    if (!record(entry.bounds) || !vector(entry.bounds.center) || !vector(entry.bounds.size) || entry.bounds.size.some((size) => size < 0)) errors.push(`${label}.bounds must contain finite world-space center and non-negative size.`);
    if ((assembly || entry.visible !== undefined) && typeof entry.visible !== "boolean") errors.push(`${label}.visible must be boolean.`);
  };
  value.assemblies.forEach((entry, index) => inspect(entry, true, index));
  actors.forEach((entry, index) => inspect(entry, false, index));
  if (errors.length) return errors;
  const children = new Map<string | undefined, string[]>();
  assemblies.forEach((entry, key) => {
    const parent = entry.parentAssemblyId as string | undefined;
    if (parent && !assemblies.has(parent)) errors.push(`Assembly "${key}" references missing parent "${parent}".`);
    const siblings = children.get(parent) ?? []; siblings.push(key); children.set(parent, siblings);
  });
  const world = new Map<string, number[]>();
  const queue = (children.get(undefined) ?? []).map((key) => ({ key, depth: 1 }));
  const verify = (entry: Record<string, unknown>, label: string) => {
    const parent = entry.parentAssemblyId as string | undefined;
    if (parent && !world.has(parent)) { errors.push(`${label} references a missing or cyclic parent "${parent}".`); return undefined; }
    const local = sceneTransformMatrix(entry.localTransform as Transform3D);
    const expected = parent ? multiplySceneMatrices(world.get(parent)!, local) : local;
    const actual = sceneTransformMatrix(entry.transform as Transform3D);
    if (expected.some((number, index) => !Number.isFinite(number) || Math.abs(number - actual[index]) > 1e-5 * Math.max(1, Math.abs(number), Math.abs(actual[index])))) errors.push(`${label}.transform does not match its evaluated parent-local world pose.`);
    return expected;
  };
  for (let index = 0; index < queue.length; index++) {
    const { key, depth } = queue[index];
    if (depth > MAX_SCENE_OWNERSHIP_DEPTH) { errors.push("Scene ownership exceeds the maximum depth."); break; }
    const matrix = verify(assemblies.get(key)!, `Assembly "${key}"`);
    if (matrix) world.set(key, matrix);
    (children.get(key) ?? []).forEach((child) => queue.push({ key: child, depth: depth + 1 }));
  }
  if (world.size !== assemblies.size) errors.push("Scene assemblies contain a cycle, missing parent, or excessive depth.");
  actors.forEach((actor) => verify(actor, `Actor "${actor.actorId}"`));
  return errors;
}
