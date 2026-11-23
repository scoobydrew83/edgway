/** The console pages (outside ra-core's resources), linked from the sidebar and the ⌘K palette. */
import {
  uiNavAudit,
  uiNavConfig,
  uiNavOverview,
  uiNavPluginCatalog,
  uiNavTester,
} from "@edgway/i18n/messages";
import type { MessageDescriptor } from "react-intl";

export interface ConsolePage {
  path: string;
  label: MessageDescriptor;
}

export const PUBLISH_PATH = "/publish";

export const CONSOLE_PAGES: ConsolePage[] = [
  { path: "/", label: uiNavOverview },
  { path: "/plugin-catalog", label: uiNavPluginCatalog },
  { path: PUBLISH_PATH, label: uiNavConfig },
  { path: "/tester", label: uiNavTester },
  { path: "/audit", label: uiNavAudit },
];
