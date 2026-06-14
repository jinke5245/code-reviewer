#### {{finding.title}}

- Location: `{{comment.location}}`
- Impact: {{comment.severityLabel}}

{{finding.body}}

{{#if finding.suggestion}}
**Suggested fix:**

{{finding.suggestion}}
{{/if}}

{{comment.suggestionBlock}}

{{comment.fingerprint}}
