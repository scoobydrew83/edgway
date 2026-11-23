/**
 * Monaco's diff editor for the publish page. This module is lazy-loaded, so
 * Monaco is a chunk of its own, fetched only by the pages that use it.
 */
import { DiffEditor } from "@monaco-editor/react";
import "./monaco";

export default function SnapshotDiff(props: {
  original: string;
  modified: string;
  language: "json" | "yaml";
  dark: boolean;
}) {
  return (
    <DiffEditor
      height="32rem"
      original={props.original}
      modified={props.modified}
      language={props.language}
      theme={props.dark ? "vs-dark" : "light"}
      options={{ readOnly: true, renderSideBySide: true }}
    />
  );
}
