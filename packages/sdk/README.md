# `@alterno-dev/spatial-review`

Register semantic Three.js roots and expose them to compatible review tools.
The editor receives only explicitly registered objects.

The package also exports `buildThreeAsset()`, `makeAssetGeometry()`, and
`disposeThreeAsset()` for websites that render an engine-neutral
`ReviewAsset3D` contract back into a Three.js hierarchy.
