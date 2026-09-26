/**
 * Registers the TypeScript extensionless-import resolver for the test run.
 * Referenced from package.json via `--import`.
 */
import { register } from "node:module";

register("./ts-resolve-hooks.mjs", import.meta.url);
