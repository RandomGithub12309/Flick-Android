/**
 * Lets the plain node test runner import modules written for the bundler.
 *
 * Vite (and the TS `bundler` resolution mode) resolve an extensionless relative
 * import like `./parse` to `./parse.ts`. Node's ESM resolver requires the
 * extension and throws ERR_MODULE_NOT_FOUND instead. Without this hook only
 * leaf modules — ones with no relative imports of their own — can be tested,
 * which is why large parts of src/lib went untested.
 *
 * Deliberately narrow: it only touches relative specifiers that have no file
 * extension, and only when the `.ts` file actually exists. Everything else
 * falls through to the default resolver.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HAS_EXTENSION = /\.[cm]?[jt]sx?$|\.json$|\.css$|\.mjs$|\.cjs$/i;

export async function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith("./") || specifier.startsWith("../");
  if (relative && !HAS_EXTENSION.test(specifier) && context.parentURL) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(candidate))) {
      return { url: candidate.href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
