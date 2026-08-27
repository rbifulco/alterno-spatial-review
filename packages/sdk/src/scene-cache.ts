import * as THREE from "three";

type ObjectState = {
  local: number[]; pose: string; world: number[]; parent: THREE.Object3D | null;
  parentRevision: number; worldRevision: number; revision: number; signature: string;
  children: number[]; bounds: THREE.Box3;
};
type GeometryState = { signature: string; revision: number; bounds: THREE.Box3 };
const equal = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((value, index) => value === b[index]);
const attributeKey = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined) => attribute
  ? `${attribute.count}:${attribute.itemSize}:${attribute.normalized}:${"data" in attribute ? attribute.data.version : attribute.version}` : "";

/** A cheap hierarchy scan detects edits; matrix products and bounds unions are incremental.
 * Call invalidate after writing raw buffers without setting attribute.needsUpdate. */
export class SceneGraphCache {
  private objects = new WeakMap<THREE.Object3D, ObjectState>();
  private geometries = new WeakMap<THREE.BufferGeometry, GeometryState>();
  private visited = new Set<THREE.Object3D>();
  private clock = 0;
  private seenGeometries = new Set<THREE.BufferGeometry>();
  private identities = new WeakMap<object, number>();
  private identity(object: object) {
    let id = this.identities.get(object);
    if (id === undefined) { id = ++this.clock; this.identities.set(object, id); }
    return id;
  }
  readonly metrics = { worldMatrices: 0, bounds: 0, geometries: 0 };

  begin() { this.visited.clear(); this.seenGeometries.clear(); this.metrics.worldMatrices = this.metrics.bounds = this.metrics.geometries = 0; }
  invalidate(roots: THREE.Object3D[]) {
    roots.forEach((root) => root.traverse((object) => {
      this.objects.delete(object);
      const geometry = (object as THREE.Mesh).geometry;
      if (geometry) this.geometries.delete(geometry);
    }));
  }

  private world(object: THREE.Object3D): ObjectState {
    const parent = object.parent ? this.world(object.parent) : undefined;
    let state = this.objects.get(object);
    const pose = [...object.position, ...object.quaternion, ...object.scale].join(",");
    if (object.matrixAutoUpdate && state?.pose !== pose) object.updateMatrix();
    const changed = !state || state.parent !== object.parent || state.parentRevision !== (parent?.worldRevision ?? 0)
      || !equal(state.local, object.matrix.elements) || !equal(state.world, object.matrixWorld.elements);
    if (changed && object.matrixWorldAutoUpdate) {
      if (object.parent) object.matrixWorld.multiplyMatrices(object.parent.matrixWorld, object.matrix);
      else object.matrixWorld.copy(object.matrix);
      object.matrixWorldNeedsUpdate = false;
      this.metrics.worldMatrices += 1;
    }
    if (!state) {
      state = { local: [], pose, world: [], parent: object.parent, parentRevision: 0, worldRevision: 0, revision: 0, signature: "", children: [], bounds: new THREE.Box3() };
      this.objects.set(object, state);
    }
    if (changed) {
      state.local = object.matrix.toArray(); state.world = object.matrixWorld.toArray(); state.worldRevision = ++this.clock;
      state.parent = object.parent; state.parentRevision = parent?.worldRevision ?? 0;
    }
    state.pose = pose;
    return state;
  }

  private geometry(geometry: THREE.BufferGeometry) {
    if (this.seenGeometries.has(geometry)) return this.geometries.get(geometry)!;
    this.seenGeometries.add(geometry);
    const signature = Object.entries(geometry.attributes).map(([name, attr]) => `${name}:${this.identity(attr)}:${attributeKey(attr)}`).join("|")
      + `/${geometry.index ? this.identity(geometry.index) : 0}:${attributeKey(geometry.index ?? undefined)}/${Object.values(geometry.morphAttributes).flat().map(attribute => `${this.identity(attribute)}:${attributeKey(attribute)}`).join("|")}/${JSON.stringify(geometry.groups)}`;
    let state = this.geometries.get(geometry);
    if (!state || state.signature !== signature) {
      geometry.computeBoundingBox();
      state = { signature, revision: ++this.clock, bounds: geometry.boundingBox?.clone() ?? new THREE.Box3() };
      this.geometries.set(geometry, state); this.metrics.geometries += 1;
    }
    return state;
  }

  inspect(object: THREE.Object3D): ObjectState {
    const state = this.world(object);
    if (this.visited.has(object)) return state;
    this.visited.add(object);
    const mesh = object as THREE.Mesh;
    const geometry = mesh.geometry?.getAttribute("position") ? this.geometry(mesh.geometry) : undefined;
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    const materialKey = materials.map((material) => {
      const m = material as THREE.MeshStandardMaterial;
      const textures = [m.map,m.normalMap,m.bumpMap,m.roughnessMap,m.metalnessMap,m.aoMap,m.emissiveMap,m.alphaMap].map(texture => texture ? `${texture.uuid}:${texture.version}:${texture.repeat.toArray()}:${texture.offset.toArray()}:${texture.rotation}:${texture.wrapS}:${texture.wrapT}:${texture.flipY}` : "").join(";");
      return `${textures}/${m.uuid}:${m.version}:${m.color?.getHex()}:${m.emissive?.getHex()}:${m.opacity}:${m.roughness}:${m.metalness}:${m.side}:${m.wireframe}`;
    }).join("|");
    const instances = object instanceof THREE.InstancedMesh ? `${object.count}:${object.instanceMatrix.version}` : "";
    const children = object.children.map((child) => this.inspect(child).revision);
    const signature = `${state.worldRevision}/${geometry?.revision}/${materialKey}/${instances}/${object.name}/${object.visible}`;
    // Skinned bounds depend on animation, which has no generic Object3D version counter.
    const dynamic = object instanceof THREE.SkinnedMesh;
    if (state.signature !== signature || !equal(state.children, children) || dynamic) {
      state.bounds.makeEmpty();
      if (geometry) {
        let local = geometry.bounds;
        if (object instanceof THREE.InstancedMesh) {
          local = new THREE.Box3();
          const matrix = new THREE.Matrix4(); const box = new THREE.Box3();
          for (let index = 0; index < object.count; index += 1) {
            object.getMatrixAt(index, matrix); local.union(box.copy(geometry.bounds).applyMatrix4(matrix));
          }
        } else if (object instanceof THREE.SkinnedMesh) {
          object.computeBoundingBox(); local = object.boundingBox ?? local;
        }
        state.bounds.copy(local).applyMatrix4(object.matrixWorld);
      }
      object.children.forEach((child) => state.bounds.union(this.objects.get(child)!.bounds));
      state.signature = signature; state.children = children; state.revision = ++this.clock; this.metrics.bounds += 1;
    }
    return state;
  }
}
