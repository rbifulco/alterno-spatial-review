# Alterno Spatial Review

Give people a consistent, convenient way to review spatial experiences built
with AI agents.

Spatial work is difficult to discuss through screenshots and prose alone.
“Move that object,” “the entrance feels too narrow,” or “use this material on
the upper volume” is useful only when the agent can identify the exact scene
actor, asset component, transform, material, and source code involved.

Alterno Spatial Review provides an open protocol and SDK for exposing that
structure. A compatible review tool can present the scene at two useful scales:

- **Scene review** preserves placement, scale, visibility, layers, and spatial
  relationships.
- **Asset review** preserves a model's component hierarchy, geometry,
  materials, textures, and component-local transforms.

Feedback can therefore stay attached to stable IDs and source references instead
of becoming an ambiguous list of visual notes.

## How it works

1. A website registers the meaningful Three.js roots in its scene.
2. It publishes a small discovery document describing the available scene,
   asset, and live-capture transports.
3. A compatible review experience loads that structured presentation.
4. The reviewer comments on the whole scene or on exact asset components.
5. An AI coding agent receives feedback grounded in stable names, IDs,
   transforms, materials, and source references.

The protocol does not scrape an arbitrary WebGL canvas. The website deliberately
exposes only the objects that should participate in review.

## Quick start

```sh
npm install @alterno-dev/spatial-review three
```

```ts
import {
  SceneAssetRegistry,
  attachSceneAssetRegistryBridge,
} from "@alterno-dev/spatial-review";

const registry = new SceneAssetRegistry("project-v1");

registry.register({
  actorId: "main-building",
  assetId: "main-building",
  name: "Main building",
  category: "Architecture",
  sourceRef: "src/scene/buildings/createMainBuilding.ts#createMainBuilding",
  root: mainBuilding,
  tags: ["building", "primary"],
});

attachSceneAssetRegistryBridge(registry, {
  allowedOrigins: ["http://localhost:3000"],
});
```

Then publish `/.well-known/spatial-review.json`:

```json
{
  "schema": "spatial-review-discovery/v1",
  "version": 1,
  "name": "My spatial project",
  "websiteUrl": "/",
  "liveCapture": "/?spatial-review-capture=1"
}
```

For a complete implementation, including repeated assets, texture URLs,
discovery manifests, origin configuration, and validation, follow the
[step-by-step AI-agent installation guide](docs/install-with-ai.md).

## What makes feedback agent-friendly

A useful integration exposes design intent, not merely render data:

- Register one coherent, reviewable object per actor rather than the entire
  world as a single asset.
- Give actors, assets, groups, meshes, and materials stable semantic names.
- Use one `assetId` for repeated instances of the same canonical design and a
  distinct `actorId` for each placement.
- Keep component hierarchy and child ordering stable so component identities
  survive rebuilds.
- Set `sourceRef` to a durable code symbol or content path the agent can find.
- Preserve public texture URLs so material feedback is shown in context.
- Include context needed to judge composition, but exclude helpers, debug
  meshes, secrets, and irrelevant implementation detail.

The [agent installation guide](docs/install-with-ai.md#present-scenes-and-assets-for-effective-review)
explains these choices in depth.

## Packages

- `@alterno-dev/spatial-review-protocol` — engine-neutral contracts,
  identifiers, types, and URL normalization.
- `@alterno-dev/spatial-review` — Three.js registry, serializer, runtime
  builder, and exact-origin browser bridge.
- `@alterno-dev/spatial-review-validator` — runtime validation for discovery,
  asset, and review-index documents.
- `@alterno-dev/spatial-review-cli` — integration validation from a terminal
  or CI.

## Guides

- [Install with an AI coding agent](docs/install-with-ai.md)
- [Website integration reference](docs/integrating-a-website.md)

## Development

```sh
npm install
npm test
npm run pack:check
```

## License

MIT
