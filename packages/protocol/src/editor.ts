import { normalizeWebsiteUrl } from "./normalize.js";

/** The exact origin trusted by the official SDK bridges unless explicitly disabled. */
export const OFFICIAL_SPATIAL_REVIEW_EDITOR_ORIGIN = "https://spatial-review.alterno.dev" as const;

/** The official project-selection entry point. */
export const OFFICIAL_SPATIAL_REVIEW_EDITOR_URL = `${OFFICIAL_SPATIAL_REVIEW_EDITOR_ORIGIN}/review` as const;

export type SpatialReviewEditorWorkspace = "review" | "scene" | "assets";

const workspacePaths: Record<SpatialReviewEditorWorkspace, string> = {
  review: "/review",
  scene: "/editor",
  assets: "/asset-editor",
};

/** Build a hosted-editor deep link that immediately connects to a website. */
export function spatialReviewEditorUrl(websiteUrl: string, workspace: SpatialReviewEditorWorkspace = "review") {
  const editorUrl = new URL(workspacePaths[workspace], OFFICIAL_SPATIAL_REVIEW_EDITOR_ORIGIN);
  editorUrl.searchParams.set("site", normalizeWebsiteUrl(websiteUrl));
  return editorUrl.href;
}
