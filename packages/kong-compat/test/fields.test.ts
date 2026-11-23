import { describe, expect, it } from "vitest";
import { fieldsOf } from "../src/validate";

describe("fieldsOf", () => {
  it("keeps a `__proto__` path off Object.prototype", () => {
    const fields = fieldsOf([
      { path: "config.__proto__.polluted", message: "bad" },
      { path: "__proto__", message: "bad" },
    ]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
    // An object literal's `__proto__` sets the prototype: compare as JSON.
    expect(JSON.stringify(fields)).toBe(
      '{"config":{"__proto__":{"polluted":"bad"}},"__proto__":"bad"}',
    );
  });

  it("lists entity-level errors under @entity", () => {
    expect(
      fieldsOf([
        { path: "", message: "one" },
        { path: "", message: "two" },
      ]),
    ).toEqual({ "@entity": ["one", "two"] });
  });

  it("nests errors, keeping a parent's own message beside its children", () => {
    const parentFirst = fieldsOf([
      { path: "config", message: "parent" },
      { path: "config.port", message: "child" },
    ]);
    expect(JSON.parse(JSON.stringify(parentFirst))).toEqual({
      config: { "@entity": ["parent"], port: "child" },
    });
    // A path before its parent: the parent's message replaces the node.
    const childFirst = fieldsOf([
      { path: "config.port", message: "child" },
      { path: "config", message: "parent" },
    ]);
    expect(childFirst.config).toBe("parent");
  });
});
