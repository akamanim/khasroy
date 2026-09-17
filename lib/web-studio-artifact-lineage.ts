import type { WebStudioAutonomousStage, WebStudioRunArtifacts } from "./web-studio-orchestrator.ts";

/**
 * Drops derived artifacts whenever an autonomous stage is rerun or a repair
 * mutates the draft. This prevents a resumed run from promoting a fingerprint,
 * GitHub commit, or SMM plan produced from an older draft revision.
 */
export function invalidateWebStudioArtifactsFromStage(
  artifacts: WebStudioRunArtifacts,
  stage: WebStudioAutonomousStage,
): WebStudioRunArtifacts {
  const next = { ...artifacts };

  if (stage === "build_draft") {
    delete next.draftProjectId;
    delete next.draftUrl;
    delete next.verifiedFingerprint;
    delete next.githubRepository;
    delete next.githubCommitSha;
    delete next.smmPlanId;
    return next;
  }

  if (stage === "repair_draft") {
    delete next.verifiedFingerprint;
    delete next.githubRepository;
    delete next.githubCommitSha;
    delete next.smmPlanId;
    return next;
  }

  if (stage === "verify_draft") {
    delete next.verifiedFingerprint;
    delete next.githubRepository;
    delete next.githubCommitSha;
    delete next.smmPlanId;
    return next;
  }

  if (stage === "export_github") {
    delete next.githubRepository;
    delete next.githubCommitSha;
    delete next.smmPlanId;
    return next;
  }

  if (stage === "prepare_smm") {
    delete next.smmPlanId;
  }

  return next;
}

export function assertWebStudioArtifactLineage(
  artifacts: WebStudioRunArtifacts,
  stage: WebStudioAutonomousStage | null,
) {
  if (artifacts.githubCommitSha && !artifacts.githubRepository) throw new Error("orchestrator_github_repository_missing");
  if ((artifacts.githubRepository || artifacts.githubCommitSha) && !artifacts.verifiedFingerprint) throw new Error("orchestrator_verified_fingerprint_missing");
  if (artifacts.smmPlanId && !artifacts.githubCommitSha) throw new Error("orchestrator_smm_github_commit_missing");
  if (stage === "ready_for_promotion") {
    if (!artifacts.draftProjectId || !artifacts.draftUrl) throw new Error("orchestrator_promotion_draft_missing");
    if (!artifacts.verifiedFingerprint) throw new Error("orchestrator_promotion_verification_missing");
    if (!artifacts.githubRepository || !artifacts.githubCommitSha) throw new Error("orchestrator_promotion_github_missing");
  }
  return true;
}
