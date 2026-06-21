import Handlebars from "handlebars";

/** Options for rendering a review Markdown template. */
export type RenderReviewTemplateOptions = {
  fingerprintMarker: string;
  template: string;
  values: Record<string, unknown>;
};

type KnownTemplatePlaceholders = {
  arrayItems: Map<string, Set<string>>;
  global: Set<string>;
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
  knownPlaceholders: KnownTemplatePlaceholders,
): {
  placeholders: Record<string, string>;
  template: string;
} {
  const placeholders: Record<string, string> = {};
  const eachScopes: string[] = [];
  let index = 0;
  const protectedTemplate = template.replace(
    /\{\{\{?\s*([^{}]+?)\s*\}?\}\}/gu,
    (placeholder: string, expression: string) => {
      const tag = expression.trim();
      const eachPath = readEachPath(tag);

      if (eachPath !== undefined) {
        eachScopes.push(eachPath);
        return placeholder;
      }

      if (tag === "/each") {
        eachScopes.pop();
        return placeholder;
      }

      if (isHandlebarsControlTag(tag)) {
        return placeholder;
      }

      const path = readPlaceholderPath(tag);

      if (
        path === undefined ||
        isKnownPlaceholder(path, eachScopes, knownPlaceholders)
      ) {
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
): KnownTemplatePlaceholders {
  const placeholders: KnownTemplatePlaceholders = {
    arrayItems: new Map<string, Set<string>>(),
    global: new Set<string>(),
  };

  for (const [key, value] of Object.entries(values)) {
    collectKnownTemplatePlaceholderPaths(key, value, placeholders);
  }

  return placeholders;
}

function collectKnownTemplatePlaceholderPaths(
  path: string,
  value: unknown,
  placeholders: KnownTemplatePlaceholders,
): void {
  placeholders.global.add(path);

  if (Array.isArray(value)) {
    placeholders.global.add(`${path}.length`);
    for (const item of value) {
      if (isRecord(item)) {
        collectKnownTemplateArrayItemPaths(path, item, placeholders);
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

function collectKnownTemplateArrayItemPaths(
  arrayPath: string,
  item: Record<string, unknown>,
  placeholders: KnownTemplatePlaceholders,
): void {
  let itemPlaceholders = placeholders.arrayItems.get(arrayPath);

  if (itemPlaceholders === undefined) {
    itemPlaceholders = new Set<string>();
    placeholders.arrayItems.set(arrayPath, itemPlaceholders);
  }

  collectKnownTemplateArrayItemPlaceholderPaths("this", item, itemPlaceholders);

  for (const [key, child] of Object.entries(item)) {
    collectKnownTemplateArrayItemPlaceholderPaths(key, child, itemPlaceholders);
  }
}

function collectKnownTemplateArrayItemPlaceholderPaths(
  path: string,
  value: unknown,
  placeholders: Set<string>,
): void {
  placeholders.add(path);

  if (!isRecord(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    collectKnownTemplateArrayItemPlaceholderPaths(
      `${path}.${key}`,
      child,
      placeholders,
    );
  }
}

function isKnownPlaceholder(
  path: string,
  eachScopes: string[],
  knownPlaceholders: KnownTemplatePlaceholders,
): boolean {
  if (knownPlaceholders.global.has(path)) {
    return true;
  }

  for (const scope of eachScopes.slice().reverse()) {
    if (knownPlaceholders.arrayItems.get(scope)?.has(path) === true) {
      return true;
    }
  }

  return false;
}

function readEachPath(tag: string): string | undefined {
  const match =
    /^#each\s+([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*)$/u.exec(tag);

  return match?.[1];
}

function readPlaceholderPath(tag: string): string | undefined {
  const match = /^([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*)$/u.exec(
    tag,
  );

  return match?.[1];
}

function isHandlebarsControlTag(tag: string): boolean {
  return (
    tag === "else" ||
    tag.startsWith("#") ||
    tag.startsWith("/") ||
    tag.startsWith("^") ||
    tag.startsWith("!") ||
    tag.startsWith(">")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
