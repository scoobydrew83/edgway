/**
 * Monaco, bundled (monaco-editor, Drew's decision: no CDN calls
 * from the admin UI): the editor core and the languages the console shows,
 * not every language. Imported only by the lazy-loaded editor modules.
 */
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/languages/definitions/yaml/register";
import "monaco-editor/languages/definitions/javascript/register";
import "monaco-editor/languages/features/json/register";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/languages/features/json/json.worker?worker";

self.MonacoEnvironment = {
  getWorker: (_id, label) =>
    label === "json" ? new JsonWorker() : new EditorWorker(),
};
loader.config({ monaco });
