import { afterEach, describe, expect, it, vi } from "vitest";

describe("readPackageInfo", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("node:module");
  });

  it("falls back to the package root when loaded from compiled dist/src files", async () => {
    const requestedModules: string[] = [];

    vi.doMock("node:module", () => ({
      createRequire() {
        return (moduleId: string) => {
          requestedModules.push(moduleId);

          if (moduleId === "../package.json") {
            const error = new Error("Cannot find module '../package.json'");
            Object.assign(error, {
              code: "MODULE_NOT_FOUND",
            });
            throw error;
          }

          if (moduleId === "../../package.json") {
            return {
              name: "@jinke5245/code-reviewer",
              version: "0.1.0",
            };
          }

          throw new Error(`Unexpected module request: ${moduleId}`);
        };
      },
    }));

    const { readPackageInfo } = await import("../../src/package-info.js");

    expect(readPackageInfo()).toEqual({
      name: "@jinke5245/code-reviewer",
      version: "0.1.0",
    });
    expect(requestedModules).toEqual(["../package.json", "../../package.json"]);
  });

  it("reports missing package metadata clearly", async () => {
    vi.doMock("node:module", () => ({
      createRequire() {
        return () => ({
          name: "@jinke5245/code-reviewer",
        });
      },
    }));

    const { readPackageInfo } = await import("../../src/package-info.js");

    expect(() => readPackageInfo()).toThrow(
      /package\.json is missing a valid version/,
    );
  });

  it("reports missing package names clearly", async () => {
    vi.doMock("node:module", () => ({
      createRequire() {
        return () => ({
          name: "",
          version: "0.1.0",
        });
      },
    }));

    const { readPackageInfo } = await import("../../src/package-info.js");

    expect(() => readPackageInfo()).toThrow(
      /package\.json is missing a valid name/,
    );
  });

  it("rethrows the final module miss when package metadata cannot be found", async () => {
    vi.doMock("node:module", () => ({
      createRequire() {
        return (moduleId: string) => {
          const error = new Error(`Cannot find module '${moduleId}'`);
          Object.assign(error, {
            code: "MODULE_NOT_FOUND",
          });
          throw error;
        };
      },
    }));

    const { readPackageInfo } = await import("../../src/package-info.js");

    expect(() => readPackageInfo()).toThrow(
      /Cannot find module '\.\.\/\.\.\/package\.json'/,
    );
  });

  it("rethrows package metadata load failures that are not module misses", async () => {
    vi.doMock("node:module", () => ({
      createRequire() {
        return () => {
          const error = new Error("package metadata is unreadable");
          Object.assign(error, {
            code: "EACCES",
          });
          throw error;
        };
      },
    }));

    const { readPackageInfo } = await import("../../src/package-info.js");

    expect(() => readPackageInfo()).toThrow(/package metadata is unreadable/);
  });
});
