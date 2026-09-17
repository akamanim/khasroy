import { assertWebStudioArtifactLineage, invalidateWebStudioArtifactsFromStage } from "./web-studio-artifact-lineage.ts";

export type WebStudioAutonomousStage =
  | "build_draft"
  | "verify_draft"
  | "repair_draft"
  | "export_github"
  | "prepare_smm"