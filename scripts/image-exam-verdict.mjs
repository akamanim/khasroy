export function imageExamExitCode(result) {
  if (!result || result.passed !== true) return 2;
  return 0;
}
