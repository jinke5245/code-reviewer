import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep as pathSeparator } from "node:path";

export function resolveRepositoryPath(cwd: string, path: string): string {
  assertRepositoryRelativePath(path);

  const root = resolve(cwd);
  const resolvedPath = resolve(root, path);
  assertPathInsideRoot(root, resolvedPath, path);

  return resolvedPath;
}

export async function resolveRepositoryRealPath(
  cwd: string,
  path: string,
): Promise<string> {
  const root = resolve(cwd);
  const resolvedPath = resolveRepositoryPath(cwd, path);
  const [realRoot, realResolvedPath] = await Promise.all([
    realpath(root),
    realpath(resolvedPath),
  ]);

  assertPathInsideRoot(realRoot, realResolvedPath, path);

  return realResolvedPath;
}

export function assertRepositoryRelativePath(path: string): void {
  if (path.includes("\0")) {
    throw new Error(`Path must stay inside the repository: ${path}`);
  }

  if (isAbsolute(path)) {
    throw new Error(`Path must stay inside the repository: ${path}`);
  }

  const parts = path.split(/[\\/]+/u);

  if (parts.includes("..")) {
    throw new Error(`Path must stay inside the repository: ${path}`);
  }
}

function assertPathInsideRoot(
  root: string,
  resolvedPath: string,
  originalPath: string,
): void {
  const relativePath = relative(root, resolvedPath);

  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${pathSeparator}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Path must stay inside the repository: ${originalPath}`);
  }
}
