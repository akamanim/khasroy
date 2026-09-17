import assert from "node:assert/strict";
import { assertWebStudioArtifactLineage, invalidateWebStudioArtifactsFromStage } from "../lib/web-studio-artifact-lineage.ts";

const complete = {
  draftProjectId: "draft-1",
  draftUrl: "https://draft.example/site/draft-1",
  verifiedFingerprint: "sha256:v1",
  githubRepository: "akamanim/site-draft",
  githubCommitSha: "abc123",
  smmPlanId: "smm-1",
};

assert.equal(assertWebStudioArtifactLineage(complete, "ready_for_promotion"), true);

const repaired = invalidateWebStudioArtifactsFromStage(complete, "repair_draft");
assert.equal(repaired.draftProjectId, "draft-1");
assert.equal(repaired.draftUrl, "https://draft.example/site/draft-1");
assert.equal(repaired.verifiedFingerprint, undefined);
assert.equal(repaired.githubCommitSha, undefined);
assert.equal(repaired.smmPlanId, undefined);

const reverified = invalidateWebStudioArtifactsFromStage(complete, "verify_draft");
assert.equal(reverified.verifiedFingerprint, undefined);
assert.equal(reverified.githubRepository, undefined);

const reexported = invalidateWebStudioArtifactsFromStage(complete, "export_github");
assert.equal(reexported.verifiedFingerprint, "sha256:v1");
assert.equal(reexported.githubRepository, undefined);
assert.equal(reexported.smmPlanId, undefined);

const rebuilt = invalidateWebStudioArtifactsFromStage(complete, "build_draft");
assert.deepEqual(rebuilt, {});

assert.throws(() => assertWebStudioArtifactLineage({ githubCommitSha: "abc" }, null), /github_repository_missing/);
assert.throws(() => assertWebStudioArtifactLineage({ githubRepository: "repo", githubCommitSha: "abc" }, null), /verified_fingerprint_missing/);
assert.throws(() => assertWebStudioArtifactLineage({ verifiedFingerprint: "fp", githubRepository: "repo", githubCommitSha: "abc", smmPlanId: "smm" }, "ready_for_promotion"), /promotion_draft_missing/);

console.log("web studio artifact lineage contract: ok");
