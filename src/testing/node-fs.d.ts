// Types for the one node:fs call the unit tests make. The project has no @types/node
// (spec 5 allows no new dependency). App code must not import node:fs.
declare module "node:fs" {
  export function readFileSync(path: string | URL): Uint8Array;
  export function readFileSync(path: string | URL, encoding: "utf8"): string;
}
