declare module "consistent-hash" {
  interface Options {
    range?: number;
    weight?: number;
    distribution?: "random" | "uniform";
  }
  export default class ConsistentHash {
    constructor(options?: Options);
    add(node: string, weight?: number): this;
    get(resource: string): string | null;
    get(resource: string, count: number): string[];
  }
}
