import Handlebars from "handlebars";

/** Options for rendering a review Markdown template. */
export type RenderReviewTemplateOptions = {
  fingerprintMarker: string;
  template: string;
  values: Record<string, unknown>;
};

/** Renders a review Markdown template while preserving Code Reviewer markers. */
export function renderReviewTemplate({
  fingerprintMarker,
  template,
  values,
}: RenderReviewTemplateOptions): string {
  const protectedTemplate = protectUnknownTemplatePlaceholders(
    template,
    collectKnownTemplatePlaceholders(values),
  );
  const compiledTemplate = Handlebars.compile(protectedTemplate.template, {
    noEscape: true,
  });
  const rendered = compiledTemplate({
    ...values,
    codeReviewerUnknownPlaceholders: protectedTemplate.placeholders,
  });

  return rendered.includes(fingerprintMarker)
    ? rendered
    : [rendered.trimEnd(), fingerprintMarker].join("\n\n");
}

function protectUnknownTemplatePlaceholders(
  template: string,
  knownPlaceholders: Set<string>,
): {
  placeholders: Record<string, string>;
  template: string;
} {
  const placeholders: Record<string, string> = {};
  let index = 0;
  const protectedTemplate = template.replace(
    /\{\{\{?\s*([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+)\s*\}?\}\}/gu,
    (placeholder: string, path: string) => {
      if (knownPlaceholders.has(path)) {
        return placeholder;
      }

      const placeholderName = `placeholder${String(index)}`;
      placeholders[placeholderName] = placeholder;
      index += 1;

      return `{{{codeReviewerUnknownPlaceholders.${placeholderName}}}}`;
    },
  );

  return {
    placeholders,
    template: protectedTemplate,
  };
}

function collectKnownTemplatePlaceholders(
  values: Record<string, unknown>,
): Set<string> {
  const placeholders = new Set<string>();

  for (const [key, value] of Object.entries(values)) {
    collectKnownTemplatePlaceholderPaths(key, value, placeholders);
  }

  return placeholders;
}

function collectKnownTemplatePlaceholderPaths(
  path: string,
  value: unknown,
  placeholders: Set<string>,
): void {
  placeholders.add(path);

  if (Array.isArray(value)) {
    placeholders.add(`${path}.length`);
    for (const item of value) {
      if (isRecord(item)) {
        collectKnownTemplatePlaceholderPaths("this", item, placeholders);
      }
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    collectKnownTemplatePlaceholderPaths(`${path}.${key}`, child, placeholders);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
