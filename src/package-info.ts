import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Package metadata read from the root `package.json`. */
export type PackageInfo = {
  name: string;
  version: string;
};

/** Reads and validates package name/version metadata. */
export function readPackageInfo(): PackageInfo {
  const packageJson = readPackageJson();

  if (typeof packageJson.name !== "string" || packageJson.name.length === 0) {
    throw new Error("package.json is missing a valid name");
  }

  if (
    typeof packageJson.version !== "string" ||
    packageJson.version.length === 0
  ) {
    throw new Error("package.json is missing a valid version");
  }

  return {
    name: packageJson.name,
    version: packageJson.version,
  };
}

function readPackageJson(): Partial<PackageInfo> {
  const candidates = ["../package.json", "../../package.json"];
  let notFoundError: unknown;

  for (const candidate of candidates) {
    try {
      return require(candidate) as Partial<PackageInfo>;
    } catch (error) {
      if (!isModuleNotFoundError(error)) {
        throw error;
      }

      notFoundError = error;
    }
  }

  if (notFoundError instanceof Error) {
    throw notFoundError;
  }

  throw new Error("Cannot find package.json");
}

function isModuleNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "MODULE_NOT_FOUND"
  );
}
