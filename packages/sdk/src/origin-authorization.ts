import {
  OFFICIAL_SPATIAL_REVIEW_EDITOR_ORIGIN,
  normalizeSpatialReviewProducerOrigin,
  normalizeSpatialReviewEditorOriginPolicy,
  type SpatialReviewEditorOriginPolicy,
} from "@alterno-dev/spatial-review-protocol";

export type SpatialReviewEditorAuthorizationOptions = {
  /** Trust the official Alterno editor origin. Defaults to true. */
  allowOfficialEditor?: boolean;
  /** Exact canonical runtime origins. These are private unless disclosed explicitly. */
  allowedOrigins?: Iterable<string>;
  /** Runtime-only dynamic authorization. It can never be advertised in discovery. */
  allowOrigin?: (origin: string) => boolean;
  /** Trust other loopback origins while the producer is on loopback. Defaults to false. */
  allowLoopbackPeers?: boolean;
};

export type SpatialReviewEditorAuthorizationConfiguration = SpatialReviewEditorAuthorizationOptions & {
  /** Explicit public disclosure. The list must exactly match every finite
   * non-same-origin runtime editor origin, including the official editor. */
  advertiseEditorOriginPolicy?: { publicOrigins: Iterable<string> };
};

const AUTHORIZATION = Symbol("SpatialReviewEditorAuthorization");

export type SpatialReviewEditorAuthorization = Readonly<{
  [AUTHORIZATION]: true;
  allowOfficialEditor: boolean;
  allowedOrigins: readonly string[];
  allowOrigin?: (origin: string) => boolean;
  allowLoopbackPeers: boolean;
  advertisedOrigins?: readonly string[];
}>;

export type SpatialReviewEditorAuthorizationSource =
  | SpatialReviewEditorAuthorizationOptions
  | SpatialReviewEditorAuthorization
  | { authorization: SpatialReviewEditorAuthorization };

function canonicalConfiguredOrigin(value: unknown, label: string) {
  try {
    const policy = normalizeSpatialReviewEditorOriginPolicy({ mode: "allowlist", origins: [value] });
    if (policy.mode !== "allowlist") throw new Error("expected an allowlist");
    return policy.origins[0];
  } catch (error) {
    throw new Error(`${label} is invalid: ${error instanceof Error ? error.message : "expected an exact canonical origin"}`);
  }
}

function canonicalOrigins(values: Iterable<string> | undefined, label: string) {
  let materialized: string[];
  try { materialized = [...(values ?? [])]; }
  catch { throw new Error(`${label} must be an iterable of exact canonical origins.`); }
  const normalized = materialized.map((value, index) => canonicalConfiguredOrigin(value, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must not contain duplicate origins.`);
  return normalized.sort();
}

function sameOrigins(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((origin, index) => origin === right[index]);
}

function finiteRuntimeOrigins(allowOfficialEditor: boolean, allowedOrigins: readonly string[]) {
  return [...new Set([
    ...(allowOfficialEditor ? [OFFICIAL_SPATIAL_REVIEW_EDITOR_ORIGIN] : []),
    ...allowedOrigins,
  ])].sort();
}

/** Create one immutable authorization decision for reuse by discovery and
 * capture bridges. Runtime origins remain private unless public disclosure is
 * explicitly requested with an exact matching list. */
export function createSpatialReviewEditorAuthorization(
  configuration: SpatialReviewEditorAuthorizationConfiguration = {},
): SpatialReviewEditorAuthorization {
  if (configuration.allowOfficialEditor !== undefined && typeof configuration.allowOfficialEditor !== "boolean") throw new Error("allowOfficialEditor must be boolean when present.");
  if (configuration.allowLoopbackPeers !== undefined && typeof configuration.allowLoopbackPeers !== "boolean") throw new Error("allowLoopbackPeers must be boolean when present.");
  if (configuration.allowOrigin !== undefined && typeof configuration.allowOrigin !== "function") throw new Error("allowOrigin must be a function when present.");
  const allowOfficialEditor = configuration.allowOfficialEditor !== false;
  const allowedOrigins = canonicalOrigins(configuration.allowedOrigins, "allowedOrigins");
  let advertisedOrigins: readonly string[] | undefined;
  if (configuration.advertiseEditorOriginPolicy !== undefined) {
    if (!configuration.advertiseEditorOriginPolicy || typeof configuration.advertiseEditorOriginPolicy !== "object") throw new Error("advertiseEditorOriginPolicy must explicitly provide publicOrigins.");
    if (!("publicOrigins" in configuration.advertiseEditorOriginPolicy)) throw new Error("advertiseEditorOriginPolicy must explicitly provide publicOrigins.");
    if (configuration.allowOrigin) throw new Error("Dynamic allowOrigin authorization cannot be represented by editorOriginPolicy discovery metadata.");
    const disclosed = canonicalOrigins(configuration.advertiseEditorOriginPolicy.publicOrigins, "advertiseEditorOriginPolicy.publicOrigins");
    const runtime = finiteRuntimeOrigins(allowOfficialEditor, allowedOrigins);
    if (!sameOrigins(disclosed, runtime)) throw new Error("advertiseEditorOriginPolicy.publicOrigins must exactly match every finite runtime editor origin.");
    advertisedOrigins = Object.freeze(disclosed);
  }
  return Object.freeze({
    [AUTHORIZATION]: true as const,
    allowOfficialEditor,
    allowedOrigins: Object.freeze(allowedOrigins),
    ...(configuration.allowOrigin ? { allowOrigin: configuration.allowOrigin } : {}),
    allowLoopbackPeers: configuration.allowLoopbackPeers === true,
    ...(advertisedOrigins === undefined ? {} : { advertisedOrigins }),
  });
}

function isAuthorization(value: unknown): value is SpatialReviewEditorAuthorization {
  return Boolean(value && typeof value === "object" && (value as Partial<SpatialReviewEditorAuthorization>)[AUTHORIZATION] === true);
}

export function resolveSpatialReviewEditorAuthorization(source: SpatialReviewEditorAuthorizationSource = {}) {
  if (isAuthorization(source)) return source;
  if (source && typeof source === "object" && "authorization" in source) {
    const wrapped = source as { authorization?: unknown } & SpatialReviewEditorAuthorizationOptions;
    if (!isAuthorization(wrapped.authorization)) throw new Error("authorization must come from createSpatialReviewEditorAuthorization().");
    if (wrapped.allowOfficialEditor !== undefined || wrapped.allowedOrigins !== undefined || wrapped.allowOrigin !== undefined || wrapped.allowLoopbackPeers !== undefined) {
      throw new Error("Do not mix a shared authorization with raw authorization options.");
    }
    return wrapped.authorization;
  }
  return createSpatialReviewEditorAuthorization(source as SpatialReviewEditorAuthorizationOptions);
}

function parsedOrigin(value: string) {
  try { return new URL(value).origin; } catch { return undefined; }
}

function loopback(origin: string) {
  try {
    const hostname = new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch { return false; }
}

export function spatialReviewEditorOriginAllowed(
  authorization: SpatialReviewEditorAuthorization,
  producerOrigin: string,
  editorOrigin: string,
) {
  const producer = parsedOrigin(producerOrigin);
  const editor = parsedOrigin(editorOrigin);
  if (!producer || !editor || producer !== producerOrigin || editor !== editorOrigin) return false;
  return editor === producer
    || authorization.allowedOrigins.includes(editor)
    || (authorization.allowOfficialEditor && editor === OFFICIAL_SPATIAL_REVIEW_EDITOR_ORIGIN)
    || Boolean(authorization.allowOrigin?.(editor))
    || (authorization.allowLoopbackPeers && loopback(producer) && loopback(editor));
}

/** Return public policy only for a shared configuration whose finite origins
 * were explicitly reviewed for disclosure. */
export function spatialReviewEditorOriginPolicy(
  authorization: SpatialReviewEditorAuthorization,
  producerUrl: string,
): SpatialReviewEditorOriginPolicy | undefined {
  if (authorization.advertisedOrigins === undefined || authorization.allowOrigin) return undefined;
  const producer = normalizeSpatialReviewProducerOrigin(producerUrl);
  const external = authorization.advertisedOrigins.filter((candidate) => candidate !== producer);
  const allowLoopbackPeers = authorization.allowLoopbackPeers ? { allowLoopbackPeers: true } as const : {};
  return normalizeSpatialReviewEditorOriginPolicy(external.length === 0
    ? { mode: "same-origin", ...allowLoopbackPeers }
    : { mode: "allowlist", origins: [producer, ...external], ...allowLoopbackPeers });
}
