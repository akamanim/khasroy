import assert from 'node:assert/strict';
import { imageExamExitCode } from './image-exam-verdict.mjs';

assert.equal(imageExamExitCode({ passed: true }), 0, 'passed visual exam must exit 0');
assert.equal(imageExamExitCode({ passed: false }), 2, 'failed visual exam must fail CI');
assert.equal(imageExamExitCode(null), 2, 'missing result must fail CI');
assert.equal(imageExamExitCode({}), 2, 'ambiguous result must fail CI');
console.log('image-exam-verdict: 4/4 passed');
