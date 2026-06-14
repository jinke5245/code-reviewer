### Review overview

- Reviewed commit: `{{review.overview.commit}}`
- Changed files: {{review.overview.changedFiles}}
- Findings: {{review.overview.findings}}
- Highest severity: {{review.overview.highestSeverity}}
- Inline findings: {{review.overview.inlineFindings}}
- Unmapped findings: {{review.overview.unmappedFindings}}
- Publish mode: {{review.overview.publishModeLabel}}

{{review.summary}}

### Findings

{{#if review.findings.length}}
{{#each review.findings}}
{{number}}. **[{{severityLabel}}] {{title}}**
{{/each}}
{{else}}
No findings.
{{/if}}

### Metadata

- Tool calls: {{review.metadata.toolCalls}}
- Prompt bytes: {{review.metadata.promptBytes}}

{{comment.fingerprint}}
