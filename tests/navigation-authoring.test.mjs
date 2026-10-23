import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { SceneAssetRegistry } from "../packages/sdk/dist/index.js";
import { validateSceneDocument, validateReviewIndex } from "../packages/validator/dist/index.js";

function route() {
  const curve = (track, parameter) => ({
    kind: "catmull-rom", timingVersion: 1,
    timing: [{ id: "artwork-reveal", time: .6, parameter }],
    points: [
      { id: `${track}-start`, role: "stop", stopId: "start", time: 0, position: [0, 1, 0], outgoing: [1, 0, 0] },
      { id: `${track}-support`, role: "through", generated: true, time: .1, position: [.1, 1, 0], incoming: [-.1, 0, 0], outgoing: [.1, 0, 0] },
      { id: `${track}-view`, name: `${track} handle`, role: "through", momentId: "artwork-reveal", momentName: "Artwork reveal", time: parameter,
        position: [parameter, 1, 0], incoming: [-.1, 0, 0], outgoing: [.1, 0, 0] },
      { id: `${track}-end`, role: "stop", stopId: "end", time: 1, position: [1, 1, 0], incoming: [-.1, 0, 0] },
    ],
  });
  return {
    id: "gallery-tour", name: "Gallery tour", sourceRef: "src/route.ts#galleryTour",
    stops: [
      { id: "start", name: "Entrance", camera: [0, 1, 0], target: [0, 1, 0], fov: 50 },
      { id: "end", name: "Exit", camera: [1, 1, 0], target: [1, 1, 0], fov: 45 },
    ],
    segments: [{ id: "approach", name: "Approach artwork", fromStopId: "start", toStopId: "end", weight: 2, lensStart: .25,
      camera: curve("camera", .35), aim: { kind: "curve", curve: curve("aim", .7) } }],
  };
}

function scene(sequence = route()) { return { schema: "scene-actors/v1", actors: [], navigationSequences: [sequence] }; }

test("named saved views with distinct geometry parameters validate and survive SDK snapshots and JSON", () => {
  const sequence = route();
  const registry = new SceneAssetRegistry("gallery");
  registry.registerNavigationSequence(sequence);
  sequence.segments[0].camera.points[2].name = "Outside mutation";
  const catalog = registry.toReviewIndex("gallery");
  assert.equal(validateReviewIndex(catalog).ok, true);
  const exported = JSON.parse(JSON.stringify(catalog.scene));
  assert.equal(validateSceneDocument(exported).ok, true);
  assert.deepEqual(exported.navigationSequences[0], route());
  catalog.scene.navigationSequences[0].segments[0].camera.timing[0].time = .9;
  assert.equal(registry.toNavigationSequences()[0].segments[0].camera.timing[0].time, .6);
  const replacement = route();
  replacement.name = "Renamed tour";
  replacement.segments[0].camera.timing[0].time = .8;
  replacement.segments[0].aim.curve.timing[0].time = .8;
  registry.registerNavigationSequence(replacement);
  assert.deepEqual(registry.toNavigationSequences()[0], replacement);
  assert.equal(validateReviewIndex(registry.toReviewIndex("gallery")).ok, true);
});

test("legacy curves, legacy moment points, closed geometry and empty timing maps remain valid", () => {
  const sequence = route();
  for (const curve of [sequence.segments[0].camera, sequence.segments[0].aim.curve]) {
    delete curve.timing; delete curve.timingVersion;
  }
  assert.equal(validateSceneDocument(scene(sequence)).ok, true, "legacy geometry times and paired metadata");
  for (const curve of [sequence.segments[0].camera, sequence.segments[0].aim.curve]) {
    for (const point of curve.points) for (const field of ["time", "incoming", "outgoing", "momentId", "momentName", "generated"]) delete point[field];
    curve.timing = []; curve.timingVersion = 1;
  }
  assert.equal(validateSceneDocument(scene(sequence)).ok, true, "empty maps with implicit geometry parameters");
  for (const curve of [sequence.segments[0].camera, sequence.segments[0].aim.curve]) {
    delete curve.timing; delete curve.timingVersion;
    curve.closed = true;
    curve.points.forEach((point, index) => { point.time = index / curve.points.length; });
  }
  assert.equal(validateSceneDocument(scene(sequence)).ok, true, "explicit closed geometry parameters");
});

const invalidCases = [
  ["unknown timing version", s => { s.camera.timingVersion = 2; }, /timingVersion 1/],
  ["missing timing version", s => { delete s.camera.timingVersion; }, /timingVersion 1/],
  ["missing timing array", s => { delete s.camera.timing; }, /timing array/],
  ["null map", s => { s.camera.timing = null; }, /timing array/],
  ["malformed anchor", s => { s.camera.timing[0] = null; }, /anchor object/],
  ["nonfinite clock", s => { s.camera.timing[0].time = NaN; }, /strictly increasing/],
  ["infinite geometry parameter", s => { s.camera.timing[0].parameter = Infinity; }, /strictly increasing/],
  ["endpoint timing", s => { s.camera.timing[0].time = 1; }, /strictly between/],
  ["string parameter", s => { s.camera.timing[0].parameter = ".35"; }, /strictly increasing/],
  ["duplicate anchor", s => { s.camera.timing.push({ ...s.camera.timing[0] }); }, /duplicate id/],
  ["unknown anchor point", s => { s.camera.timing[0].id = "missing"; }, /momentId point/],
  ["mismatched geometry parameter", s => { s.camera.timing[0].parameter = .4; }, /momentId point/],
  ["missing view constraint", s => { s.camera.timing = []; }, /missing saved-view anchor/],
  ["unpaired clock", s => { s.camera.timing[0].time = .8; }, /playback times must match/],
  ["unpaired view name", s => { s.camera.points[2].momentName = "Something else"; }, /names must match/],
  ["automatic aim with views", s => { s.aim = { kind: "path-facing", lookDistance: 5 }; }, /both camera and aim/],
  ["duplicate saved view", s => { s.camera.points[1].momentId = "artwork-reveal"; }, /duplicate momentId/],
  ["generated saved view", s => { s.camera.points[2].generated = true; }, /authored interior/],
  ["saved view on stop", s => { s.camera.points[2].stopId = "start"; }, /authored interior/],
  ["unassociated view name", s => { delete s.camera.points[2].momentId; }, /requires momentId/],
  ["invalid handle name", s => { s.camera.points[2].name = " "; }, /name must be a non-empty string/],
  ["invalid transition name", s => { s.name = 42; }, /name must be a non-empty string/],
  ["partial geometry times", s => { delete s.camera.points[1].time; }, /strictly increasing geometry/],
  ["unordered geometry", s => { s.camera.points[1].time = .5; }, /strictly increasing geometry/],
  ["open geometry endpoint", s => { s.camera.points.at(-1).time = .9; }, /strictly increasing geometry/],
  ["closed geometry endpoint", s => { s.camera.closed = true; }, /strictly increasing geometry/],
  ["malformed offset", s => { s.camera.points[0].outgoing = [1, 2]; }, /finite XYZ offset/],
  ["nonfinite offset", s => { s.camera.points[0].outgoing = [1, NaN, 2]; }, /finite XYZ offset/],
  ["offsets without parameters", s => { s.camera.points.forEach(point => { delete point.time; }); }, /offsets require explicit/],
  ["nonboolean generated", s => { s.camera.points[1].generated = "yes"; }, /generated must be boolean/],
  ["nonboolean editability", s => { s.camera.points[1].editable = "yes"; }, /editable must be boolean/],
  ["map on line", s => { s.camera.kind = "line"; }, /timing requires catmull-rom/],
  ["map on sampled curve", s => { s.camera = { kind: "sampled", samples: [[0, 0, 0], [1, 0, 0]], timing: [], timingVersion: 1 }; }, /timing requires catmull-rom/],
];
for (const [name, mutate, expected] of invalidCases) test(`rejects ${name} without throwing`, () => {
  const sequence = route();
  mutate(sequence.segments[0]);
  let result;
  assert.doesNotThrow(() => { result = validateSceneDocument(scene(sequence)); });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), expected);
});

test("two saved views allow independent shape knot counts but cannot cross on either axis", () => {
  const sequence = route();
  for (const curve of [sequence.segments[0].camera, sequence.segments[0].aim.curve]) {
    curve.points.splice(-1, 0, { id: "second-point", role: "through", position: [.9, 1, 0], time: .9, momentId: "second-view" });
    curve.timing.push({ id: "second-view", time: .8, parameter: .9 });
  }
  sequence.segments[0].aim.curve.points.splice(1, 0, { id: "extra-knot", role: "through", time: .05, position: [.05, 1, 0] });
  assert.equal(validateSceneDocument(scene(sequence)).ok, true);
  sequence.segments[0].camera.timing.reverse();
  const invalid = validateSceneDocument(scene(sequence));
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join("\n"), /strictly increasing/);
});

test("schema and public guidance expose the versioned extension and feedback application workflow", async () => {
  const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const schema = JSON.parse(await read("schemas/navigation-sequence-v1.schema.json"));
  assert.equal(schema.$defs.curve.oneOf[1].properties.timingVersion.const, 1);
  assert.deepEqual(schema.$defs.anchor.required, ["id", "time", "parameter"]);
  const sceneSchema = JSON.parse(await read("schemas/scene-actors-v1.schema.json"));
  assert.equal(sceneSchema.properties.navigationSequences.items.$ref, "navigation-sequence-v1.schema.json");
  for (const path of ["README.md", "agents/install.md", "agents/exporting-navigation-sequences.md", "packages/sdk/README.md", "packages/protocol/README.md"]) {
    assert.match(await read(path), /applying-navigation-feedback.md/, path);
  }
  const contract = await read("docs/navigation-authoring.md");
  for (const token of ["timingVersion", "momentId", "momentName", "generated", "incoming", "outgoing", "change-path-curve", "rename-path-item", "getPointAt"]) assert.ok(contract.includes(token), token);
  assert.match(await read("agents/applying-navigation-feedback.md"), /batch/);
});
