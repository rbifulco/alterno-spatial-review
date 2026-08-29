import * as THREE from "three";
import { SCENE_ACTORS_SCHEMA, SPATIAL_REVIEW_ASSEMBLIES_CAPABILITY, validateSceneOwnership, type SceneReviewActor, type SceneReviewAssembly, type SpatialReviewScene, type Transform3D, type Vec3 } from "@alterno-dev/spatial-review-protocol";

export type SceneAssemblyRegistration = {
  assemblyId: string; name: string; sourceRef: string; parentAssemblyId?: string; visible?: boolean;
} & ({ root: THREE.Object3D; localTransform?: never } | { root?: never; localTransform: Transform3D });

export function transformMatrix(transform: Transform3D) {
  return new THREE.Matrix4().compose(new THREE.Vector3(...transform.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...transform.rotation.map(THREE.MathUtils.degToRad) as Vec3, "XYZ")),
    new THREE.Vector3(...transform.scale));
}

export function matrixTransform(matrix: THREE.Matrix4): Transform3D {
  const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  const primary = new THREE.Euler().setFromQuaternion(quaternion, "XYZ");
  // Three.js intentionally collapses the secondary XYZ solution close to the
  // +/-90-degree singularity. Just beyond that boundary, the collapsed angles
  // can flip a small cosine term and fail an otherwise exact TRS round-trip.
  // Evaluate the equivalent secondary solution and retain the faithful one.
  const secondary = new THREE.Euler(
    primary.x + Math.PI,
    primary.y,
    primary.z + Math.PI,
    "XYZ",
  );
  const error = (candidate: THREE.Euler) => {
    const recomposed = new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromEuler(candidate), scale);
    return Math.max(...matrix.elements.map((value, index) => Math.abs(value - recomposed.elements[index])));
  };
  const rotation = error(secondary) < error(primary) ? secondary : primary;
  return { position: position.toArray() as Vec3, rotation: [rotation.x, rotation.y, rotation.z].map(THREE.MathUtils.radToDeg) as Vec3, scale: scale.toArray() as Vec3 };
}

/** Logical ownership does not reparent or clone any game Object3D. */
export function assembleScene(registrations: readonly SceneAssemblyRegistration[], actors: SceneReviewActor[], hierarchical: boolean): SpatialReviewScene {
  const children = new Map<string | undefined, SceneAssemblyRegistration[]>();
  const ids = new Set(registrations.map((entry) => entry.assemblyId));
  registrations.forEach((entry) => {
    if (entry.parentAssemblyId && !ids.has(entry.parentAssemblyId)) throw new Error(`Assembly "${entry.assemblyId}" references missing parent "${entry.parentAssemblyId}".`);
    const siblings = children.get(entry.parentAssemblyId) ?? []; siblings.push(entry); children.set(entry.parentAssemblyId, siblings);
  });
  const ordered = [...(children.get(undefined) ?? [])];
  const matrices = new Map<string, THREE.Matrix4>();
  const visible = new Map<string, boolean>();
  const bounds = new Map<string, THREE.Box3>();
  const assemblies: SceneReviewAssembly[] = [];
  for (let index = 0; index < ordered.length; index++) {
    const entry = ordered[index];
    const parent = entry.parentAssemblyId ? matrices.get(entry.parentAssemblyId)! : new THREE.Matrix4();
    entry.root?.updateWorldMatrix(true, false);
    const world = entry.root ? entry.root.matrixWorld.clone() : parent.clone().multiply(transformMatrix(entry.localTransform));
    const local = parent.clone().invert().multiply(world);
    const pose = matrixTransform(world), recomposed = transformMatrix(pose);
    if (!world.elements.every((value, index) => Number.isFinite(value) && Math.abs(value - recomposed.elements[index]) < 1e-5 * Math.max(1, Math.abs(value)))) throw new Error(`Assembly "${entry.assemblyId}" has an unsupported sheared transform.`);
    matrices.set(entry.assemblyId, world);
    bounds.set(entry.assemblyId, new THREE.Box3());
    const ownVisible = entry.visible ?? entry.root?.visible ?? true;
    visible.set(entry.assemblyId, ownVisible && (!entry.parentAssemblyId || visible.get(entry.parentAssemblyId) !== false));
    assemblies.push({ assemblyId: entry.assemblyId, name: entry.name, sourceRef: entry.sourceRef, parentAssemblyId: entry.parentAssemblyId,
      localTransform: matrixTransform(local), transform: pose, bounds: { center: [0, 0, 0], size: [0, 0, 0] }, visible: ownVisible });
    ordered.push(...(children.get(entry.assemblyId) ?? []));
  }
  if (ordered.length !== registrations.length) throw new Error("Scene assemblies contain an ownership cycle.");
  const ownedActors = actors.map((actor) => {
    const parent = actor.parentAssemblyId ? matrices.get(actor.parentAssemblyId) : undefined;
    if (actor.parentAssemblyId && !parent) throw new Error(`Actor "${actor.actorId}" references missing assembly "${actor.parentAssemblyId}".`);
    const box = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...actor.bounds.center), new THREE.Vector3(...actor.bounds.size));
    if (actor.parentAssemblyId) bounds.get(actor.parentAssemblyId)!.union(box);
    return { ...actor, localTransform: matrixTransform((parent?.clone().invert() ?? new THREE.Matrix4()).multiply(transformMatrix(actor.transform))) };
  });
  for (let index = assemblies.length - 1; index >= 0; index--) {
    const assembly = assemblies[index], box = bounds.get(assembly.assemblyId)!;
    assembly.bounds = { center: (box.isEmpty() ? new THREE.Vector3(...assembly.transform.position) : box.getCenter(new THREE.Vector3())).toArray() as Vec3,
      size: (box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3())).toArray() as Vec3 };
    if (assembly.parentAssemblyId) bounds.get(assembly.parentAssemblyId)!.union(box);
  }
  const scene: SpatialReviewScene = { schema: SCENE_ACTORS_SCHEMA, actors: ownedActors, assemblies,
    ownership: { capability: SPATIAL_REVIEW_ASSEMBLIES_CAPABILITY, mode: "hierarchical" } };
  const errors = validateSceneOwnership(scene);
  if (errors.length) throw new Error(errors.join("\n"));
  if (hierarchical) return scene;
  return { schema: SCENE_ACTORS_SCHEMA,
    // Pre-extension editors may also ignore actor.visible. Omitting effectively
    // hidden placements is the only faithful fallback for those consumers.
    actors: ownedActors.filter((actor) => actor.visible !== false && (!actor.parentAssemblyId || visible.get(actor.parentAssemblyId) !== false))
      .map(({ parentAssemblyId: _parent, localTransform: _local, ...actor }) => ({ ...actor, visible: true })),
    ownership: { capability: SPATIAL_REVIEW_ASSEMBLIES_CAPABILITY, mode: "flattened", reason: "Assembly editing is unavailable: this consumer did not negotiate scene-assemblies-v1. Actors use flattened world-space poses; effectively hidden placements are omitted." } };
}
