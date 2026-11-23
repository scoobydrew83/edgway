/**
 * @edgway/tokens: the theme's CSS variables (src/theme.css) by name, for code
 * that needs a color outside Tailwind classes (charts, canvas).
 */
export const COLOR_TOKENS = [
  "background",
  "foreground",
  "primary",
  "primary-foreground",
  "muted",
  "muted-foreground",
  "destructive",
  "warning",
  "warning-foreground",
  "success",
  "success-foreground",
  "border",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

/** `var(--name)`, for inline styles and chart libraries. */
export const cssVar = (name: ColorToken) => `var(--${name})`;
