# Mobile Static Detector v1

Status: CANDIDATE / IMPLEMENTED (not VERIFIED)

## What changed
A disposable training fixture and a zero-AI Node detector were added. The detector scans simple CSS rules and reports two commercially useful mobile risks without spending model quota:

- fixed pixel width greater than 320px -> `fixed-width-overflow-risk`;
- explicit width and height both below 24px -> `undersized-pointer-target-risk`.

## Evidence
- Fixture: `examples/site-audit/mobile-audit-fixture.html` intentionally contains `.broken-wide{width:680px}` and `.tiny-target{width:18px;height:18px}` plus corrected examples.
- Detector: `scripts/mobile-audit-static.mjs` parses those CSS declarations and emits machine-readable JSON findings.
- Both files were written to `main` and fetched back successfully from GitHub.

## Why this is not VERIFIED yet
Repository evidence proves implementation, not execution. This automation environment could not clone/run the GitHub repository because its container has no outbound DNS, and the GitHub connector does not expose workflow execution. Therefore no claim is made that the detector actually executed successfully.

## Required verification
Run from the repository root:

`node scripts/mobile-audit-static.mjs examples/site-audit/mobile-audit-fixture.html`

Expected: exit code 0 and JSON containing both `fixed-width-overflow-risk` for `.broken-wide` and `undersized-pointer-target-risk` for `.tiny-target`.

Then create a corrected fixture with both defects removed. A future v2 detector should support an explicit `--expect-clean` mode and pass only when it emits zero findings. Browser-based viewport verification remains required before promoting the broader Mobile Responsive Audit skill to VERIFIED.
