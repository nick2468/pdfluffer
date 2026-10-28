// A tiny ambient type for the one node:crypto class the release test uses. The project
// has no @types/node (spec 5 allows no new dependency), as node-fs.d.ts explains.
declare module "node:crypto" {
  export class X509Certificate {
    constructor(buffer: Uint8Array | string);
    readonly fingerprint: string;
    readonly subject: string;
    readonly validFrom: string;
    readonly validTo: string;
  }
}
