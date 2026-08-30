import { SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY } from "../../packages/protocol/dist/index.js";

export function streamedAsset(assetId = "deferred-city", instanceCount = 2_048) {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return {
    id: assetId,
    name: "Deferred city",
    sourceRef: "tests/fixtures/streaming.mjs#deferred-city",
    category: "Fixture",
    tags: ["streamed"],
    nodes: [{
      id: `${assetId}-instances`,
      name: "Buildings",
      type: "mesh",
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      visible: true,
      geometry: { kind: "mesh", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      materialIds: [],
      instances: Array.from({ length: instanceCount }, (_, index) => {
        const matrix = [...identity];
        matrix[12] = index;
        return matrix;
      }),
    }],
    materials: [],
    feedback: { status: "unreviewed", summary: "", annotations: [], modifications: [] },
  };
}

export function deferredRegistration(produceRepresentation, estimatedBytes = 140_000) {
  return {
    actorId: "deferred-city-placement",
    assetId: "deferred-city",
    name: "Deferred city",
    sourceRef: "tests/fixtures/streaming.mjs#deferred-city",
    category: "Fixture",
    transform: { position: [12, 0, -4], rotation: [0, 15, 0], scale: [1, 1, 1] },
    bounds: { center: [12, 10, -4], size: [200, 20, 200] },
    stream: {
      capability: SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY,
      revision: "city-catalog-r1",
      representations: [
        { id: "overview", purpose: "overview", revision: "city-overview-r1", estimatedBytes: 1_024, triangles: 1, instances: 8, attributes: ["position"], geometricError: 4 },
        { id: "detail", purpose: "detail", revision: "city-detail-r3", estimatedBytes, triangles: 1, instances: 2_048, attributes: ["position", "normal", "uv"], geometricError: 0 },
      ],
    },
    produceRepresentation,
  };
}

export async function slowProducer(context) {
  context.reportProgress({ phase: "generating", completed: 1, total: 2 });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 20);
    context.signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("cancelled", "AbortError"));
    }, { once: true });
  });
  context.reportProgress({ phase: "generating", completed: 2, total: 2 });
  return streamedAsset(context.assetId, context.representation.id === "overview" ? 8 : 2_048);
}
