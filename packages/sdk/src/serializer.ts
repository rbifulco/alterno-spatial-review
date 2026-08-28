import * as THREE from "three";
import type { AssetGeometry, AssetGeometryDefinition, AssetMaterial, AssetNode, ReviewAsset3D, Vec3 } from "@alterno-dev/spatial-review-protocol";
import { slugify } from "./slug.js";

function hex(color: THREE.Color | undefined, fallback = "#8d8d88") { return color ? `#${color.getHexString()}` : fallback; }
function attributeArray(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined, compact = false) {
  if (!attribute) return undefined;
  const values = compact ? new Float32Array(attribute.count * attribute.itemSize) : new Array<number>(attribute.count * attribute.itemSize);
  for (let index = 0; index < attribute.count; index += 1) for (let component = 0; component < attribute.itemSize; component += 1) values[index * attribute.itemSize + component] = attribute.getComponent(index, component);
  return values;
}

function materialMaps(material: THREE.Material, onTexture?: (resourceId: string, texture: THREE.Texture) => void) {
  const candidate = material as THREE.MeshStandardMaterial;
  const slots = ["map", "normalMap", "bumpMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap"] as const;
  return slots.flatMap((slot) => {
    const texture = candidate[slot] as THREE.Texture | null | undefined;
    if (!texture) return [];
    const image = texture.source?.data as { src?: string; currentSrc?: string } | undefined;
    const annotated = typeof texture.userData.sourceRef === "string" ? texture.userData.sourceRef : typeof texture.userData.requestUrl === "string" ? texture.userData.requestUrl : undefined;
    const raw = annotated || image?.currentSrc || image?.src;
    let sourceRef = raw;
    if (raw && typeof document !== "undefined") try { sourceRef = new URL(raw, document.baseURI).href; } catch { sourceRef = raw; }
    const resourceId = `three-texture:${texture.uuid}`;
    onTexture?.(resourceId, texture);
    return [{ slot, name: texture.name || undefined, sourceRef, resourceId, wrap: texture.wrapS === THREE.RepeatWrapping || texture.wrapT === THREE.RepeatWrapping ? "repeat" as const : "clamp" as const, repeat: [texture.repeat.x, texture.repeat.y] as [number, number], offset: [texture.offset.x, texture.offset.y] as [number, number], rotation: texture.rotation, flipY: texture.flipY }];
  });
}

function serializeMaterial(material: THREE.Material, id: string, index: number, maps: boolean, onTexture?: (resourceId: string, texture: THREE.Texture) => void): AssetMaterial {
  const value = material as THREE.MeshStandardMaterial;
  return { id, name: material.name || `${material.type.replace(/Material$/, "")} ${index + 1}`, type: material.type.includes("Basic") ? "basic" : material.type.includes("Phong") ? "phong" : material.type.includes("Standard") ? "standard" : "unknown", color: hex(value.color), emissive: value.emissive ? hex(value.emissive, "#000000") : undefined, roughness: typeof value.roughness === "number" ? value.roughness : undefined, metalness: typeof value.metalness === "number" ? value.metalness : undefined, opacity: material.opacity, doubleSided: material.side === THREE.DoubleSide, wireframe: "wireframe" in material ? Boolean((material as THREE.MeshBasicMaterial).wireframe) : false, maps: maps ? materialMaps(material, onTexture) : undefined };
}

function serializeGeometry(geometry: THREE.BufferGeometry, surface: boolean, compact = false): AssetGeometry | undefined {
  const positions = attributeArray(geometry.getAttribute("position"), compact);
  if (!positions?.length) return undefined;
  const indices = geometry.index ? compact
    ? (geometry.getAttribute("position").count <= 65535 ? Uint16Array : Uint32Array).from(geometry.index.array)
    : Array.from(geometry.index.array, Number) : undefined;
  return { kind: "mesh", positions, indices, normals: surface ? attributeArray(geometry.getAttribute("normal"), compact) : undefined, uvs: surface ? attributeArray(geometry.getAttribute("uv"), compact) : undefined, groups: geometry.groups.length ? geometry.groups.map((group) => ({ start: group.start, count: group.count, materialIndex: group.materialIndex ?? 0 })) : undefined };
}

function matrixTransform(matrix: THREE.Matrix4) {
  const position = new THREE.Vector3(); const quaternion = new THREE.Quaternion(); const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  const rotation = new THREE.Euler().setFromQuaternion(quaternion, "XYZ");
  return { position, rotation: [rotation.x, rotation.y, rotation.z].map(THREE.MathUtils.radToDeg) as Vec3, scale: scale.toArray() as Vec3 };
}

export type Object3DAssetOptions = { assetId?: string; category?: string; tags?: string[]; animations?: string[]; profile?: "review" | "scene"; geometryEncoding?: "json" | "typed"; onTexture?: (resourceId: string, texture: THREE.Texture) => void;
  /** Separate a single placement root's visibility from its shared design.
   * Multi-root component visibility and all descendant flags are preserved. */
  ignoreRootVisibility?: boolean };

export function assetFromObject3DRoots(roots: THREE.Object3D[], label: string, sourceRef: string, options: Object3DAssetOptions = {}): ReviewAsset3D {
  if (!roots.length) throw new Error(`Asset "${label}" has no registered Object3D roots.`);
  roots.forEach((root) => root.updateWorldMatrix(true, true));
  const assetId = options.assetId ?? slugify(label.replace(/\.[^.]+$/, ""), "asset");
  const materialIds = new Map<THREE.Material, string>(); const geometryIds = new Map<THREE.BufferGeometry, string>();
  const materials: AssetMaterial[] = []; const geometries: AssetGeometryDefinition[] = [];
  const nodes: AssetNode[] = [{ id: `${assetId}-root`, name: label.replace(/\.[^.]+$/, ""), type: "group", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true, materialIds: [], sourceRef }];
  const sourceMatrix = roots[0].matrixWorld.clone(); const inverse = sourceMatrix.clone().invert(); const surface = options.profile !== "scene";
  const materialIdFor = (material: THREE.Material) => { const found = materialIds.get(material); if (found) return found; const index = materials.length; const id = `${assetId}-material-${slugify(material.name || material.type, "surface")}-${index + 1}`; materialIds.set(material, id); materials.push(serializeMaterial(material, id, index, surface, options.onTexture)); return id; };
  const geometryIdFor = (geometry: THREE.BufferGeometry) => { const found = geometryIds.get(geometry); if (found) return found; const value = serializeGeometry(geometry, surface, options.geometryEncoding === "typed"); if (!value) return undefined; const id = `${assetId}-geometry-${slugify(geometry.name || geometry.type, "mesh")}-${geometries.length + 1}`; geometryIds.set(geometry, id); geometries.push({ id, name: geometry.name || geometry.type, geometry: value }); return id; };
  let componentIndex = 0;
  const visit = (object: THREE.Object3D, parentId: string, path: number[], top = false) => {
    if (object instanceof THREE.Light || object instanceof THREE.Camera || object instanceof THREE.Sprite) return;
    const renderable = object as THREE.Mesh; const geometry = renderable.geometry as THREE.BufferGeometry | undefined; const geometryId = geometry?.getAttribute("position") ? geometryIdFor(geometry) : undefined;
    const name = object.name || `${object.type} ${componentIndex + 1}`; componentIndex += 1; const id = `${assetId}-${slugify(name, object.type.toLowerCase())}-${path.map((value) => value + 1).join("-")}`;
    const transform = top ? matrixTransform(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld)) : { position: object.position.clone(), rotation: [object.rotation.x, object.rotation.y, object.rotation.z].map(THREE.MathUtils.radToDeg) as Vec3, scale: object.scale.toArray() as Vec3 };
    const candidateMaterials = Array.isArray(renderable.material) ? renderable.material : renderable.material ? [renderable.material] : [];
    const instances = object instanceof THREE.InstancedMesh ? Array.from({ length: object.count }, (_, index) => { const matrix = new THREE.Matrix4(); object.getMatrixAt(index, matrix); return matrix.toArray(); }) : undefined;
    nodes.push({ id, name, type: object instanceof THREE.Line ? "line" : object instanceof THREE.Points ? "points" : geometryId ? "mesh" : "group", parentId, position: transform.position.toArray() as Vec3, rotation: transform.rotation, scale: transform.scale, visible: top && roots.length === 1 && options.ignoreRootVisibility ? true : object.visible, geometryId, materialIds: candidateMaterials.map(materialIdFor), instances, sourceRef: `${sourceRef}#${id}` });
    object.children.forEach((child, index) => visit(child, id, [...path, index]));
  };
  roots.forEach((root, index) => visit(root, `${assetId}-root`, [index], true));
  const sourceTransform = matrixTransform(sourceMatrix);
  return { id: assetId, name: label.replace(/\.[^.]+$/, ""), sourceRef, category: options.category ?? "Registered scene asset", tags: options.tags ?? ["registered", "scene-asset"], nodes, geometries, materials, sourceTransform: { position: sourceTransform.position.toArray() as Vec3, rotation: sourceTransform.rotation, scale: sourceTransform.scale }, animations: options.animations, feedback: { status: "unreviewed", summary: "", annotations: [], modifications: [] } };
}
