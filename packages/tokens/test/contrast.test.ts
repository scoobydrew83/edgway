/**
 * The theme meets WCAG 2.2 AA contrast in both themes: every
 * text pair docs/design/ui-guidelines.md lists at 4.5:1 (1.4.3), and control
 * borders, focus rings and chart lines at 3:1 (1.4.11). Colors are parsed
 * and compared with colorjs.io.
 */
import { readFileSync } from "node:fs";
import Color from "colorjs.io";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/theme.css", import.meta.url), "utf8");

/** A block's `--name: <color>` declarations, parsed. */
function tokens(block: string): Map<string, Color> {
  const start = css.indexOf(`${block} {`);
  const body = css.slice(start, css.indexOf("}", start));
  return new Map(
    [...body.matchAll(/--([\w-]+):\s*(oklch\([^)]*\))/g)].map(
      ([, name, value]) => [name as string, new Color(value as string)],
    ),
  );
}

function contrast(theme: Map<string, Color>, fg: string, bg: string) {
  const front = theme.get(fg);
  const back = theme.get(bg);
  if (!front || !back) throw new Error(`no --${fg} or --${bg}`);
  // Opaque only: a translucent token's contrast depends on what's under it.
  expect(front.alpha.valueOf()).toBe(1);
  return front.contrast(back, "WCAG21");
}

/** Text pairs (WCAG 1.4.3, 4.5:1): [foreground, backgrounds]. */
const TEXT: [string, string[]][] = [
  ["foreground", ["background", "card", "muted"]],
  ["card-foreground", ["card"]],
  ["popover-foreground", ["popover"]],
  ["muted-foreground", ["background", "card", "muted"]],
  ["secondary-foreground", ["secondary"]],
  ["accent-foreground", ["accent"]],
  ["primary-foreground", ["primary"]],
  ["destructive", ["background", "card"]],
  ["warning-foreground", ["warning"]],
  ["success-foreground", ["success"]],
  ["sidebar-foreground", ["sidebar", "sidebar-accent"]],
  ["sidebar-accent-foreground", ["sidebar-accent"]],
  ["sidebar-primary-foreground", ["sidebar-primary"]],
];

/** Non-text pairs (WCAG 1.4.11, 3:1): controls, focus rings, chart lines. */
const GRAPHICS: [string, string[]][] = [
  ["input", ["background", "card"]],
  ["ring", ["background", "card"]],
  ["sidebar-ring", ["sidebar"]],
  ["sidebar-primary", ["sidebar"]],
  ...["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"].map(
    (chart): [string, string[]] => [chart, ["card", "background"]],
  ),
];

const pairs = (list: [string, string[]][]) =>
  list.flatMap(([fg, bgs]) => bgs.map((bg) => [fg, bg] as const));

describe.each([
  [":root", "light"],
  [".dark", "dark"],
])("%s (%s theme)", (block) => {
  const theme = tokens(block);
  it.each(pairs(TEXT))("text: %s is 4.5:1 on %s", (fg, bg) => {
    expect(contrast(theme, fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(pairs(GRAPHICS))("graphics: %s is 3:1 on %s", (fg, bg) => {
    expect(contrast(theme, fg, bg)).toBeGreaterThanOrEqual(3);
  });
});
