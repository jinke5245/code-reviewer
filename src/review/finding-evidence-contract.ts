/** Instructions that define how model findings must map to MR diff evidence. */
export const reviewFindingEvidenceInstructions = [
  "For every finding, path must match a changed file and side/startLine/endLine/code must identify the smallest exact code range that shows the problem in that file's diff hunk.",
  'side "new" means the new-file side of the diff; use newLine values from read_diff.lines.',
  'side "old" means the old-file side of the diff; use oldLine values from read_diff.lines.',
  "startLine and endLine are inclusive line numbers on the selected side.",
  "For single-line findings, set startLine and endLine to the same number.",
  "For multi-line findings, every integer line from startLine through endLine on the selected side must exist in read_diff.lines.",
  'code must equal the selected read_diff.lines text values joined with "\\n", preserving indentation and line breaks exactly and excluding leading diff prefixes.',
  "Choose the smallest contiguous side-specific range that proves the issue.",
  'Example: if read_diff.lines includes {"kind":"added","newLine":240,"text":"    executedToolCalls,"}, the finding anchor must use side "new", startLine 240, endLine 240, and code "    executedToolCalls,".',
];
