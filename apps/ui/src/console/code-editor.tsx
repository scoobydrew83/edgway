/**
 * The sandbox plugin editor: Monaco on an uploaded plugin's
 * JavaScript source. Lazy-loaded, like the publish page's diff editor.
 */
import { Editor } from "@monaco-editor/react";
import "./monaco";

export default function CodeEditor(props: {
  value: string;
  onChange: (value: string) => void;
  dark: boolean;
  label: string;
}) {
  return (
    <section className="rounded-md border" aria-label={props.label}>
      <Editor
        height="50vh"
        language="javascript"
        value={props.value}
        onChange={(value) => props.onChange(value ?? "")}
        theme={props.dark ? "vs-dark" : "light"}
        options={{ minimap: { enabled: false }, tabSize: 2 }}
      />
    </section>
  );
}
