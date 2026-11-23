/**
 * The admin UI: shadcn-admin-kit's <Admin> over the SDK's dataProvider,
 * mounted at /ui (the admin Worker serves it). Light and dark themes come
 * from the kit's theme toggle; ⌘K opens the palette. The console pages
 * (overview, plugin catalog, publish, route tester) are custom routes.
 */
import { ADMIN_UI } from "@edgway/constants";
import {
  uiNavGroupConsole,
  uiNavGroupConsumers,
  uiNavGroupGateway,
  uiNavGroupTls,
  uiNavUnpublished,
  uiTitle,
} from "@edgway/i18n/messages";
import { Admin } from "@edgway/ui-kit/components/admin";
import { Layout } from "@edgway/ui-kit/components/admin/layout";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CoreLayoutProps } from "ra-core";
import { CustomRoutes, Resource } from "ra-core";
import { lazy, useEffect, useMemo } from "react";
import { type MessageDescriptor, useIntl } from "react-intl";
import { BrowserRouter, Route, useLocation } from "react-router";
import { CONSOLE_PAGES, PUBLISH_PATH } from "./console/nav";
import { usePendingChanges } from "./console/pending";
import { MobilePublishLink, StagedBanner } from "./console/staged";
import { KeyDialogProvider } from "./credentials";
import { dataProvider } from "./data-provider";
import { intlI18nProvider } from "./i18n-provider";
import { CommandPalette, PaletteButton } from "./palette";
import {
  makeCreate,
  makeEdit,
  makeList,
  makeShow,
  RESOURCES,
  type ResourceConfig,
} from "./resources";
import { IdentityFooter, useCan, ViewerNotice } from "./role";
import { GroupedSidebar } from "./sidebar";

// Console pages load on first visit (Recharts, RJSF, Monaco stay out of the
// entry chunk); the layout's Suspense shows the spinner meanwhile.
const OverviewPage = lazy(() =>
  import("./console/overview").then((m) => ({ default: m.OverviewPage })),
);
const PluginCatalogPage = lazy(() =>
  import("./console/plugins").then((m) => ({ default: m.PluginCatalogPage })),
);
const PluginFormPage = lazy(() =>
  import("./console/plugins").then((m) => ({ default: m.PluginFormPage })),
);
const PluginEditPage = lazy(() =>
  import("./console/plugins").then((m) => ({ default: m.PluginEditPage })),
);
const PublishPage = lazy(() =>
  import("./console/publish").then((m) => ({ default: m.PublishPage })),
);
const AuditPage = lazy(() =>
  import("./console/audit").then((m) => ({ default: m.AuditPage })),
);
const TesterPage = lazy(() =>
  import("./console/tester").then((m) => ({ default: m.TesterPage })),
);

/**
 * The sidebar's sections: console pages, then entities by area.
 * Targets live on their upstream's page, so they're in no section.
 */
const SECTIONS: { label: MessageDescriptor; resources: string[] }[] = [
  {
    label: uiNavGroupGateway,
    resources: [
      "services",
      "routes",
      "upstreams",
      "plugins",
      "sandbox_plugins",
    ],
  },
  {
    label: uiNavGroupConsumers,
    resources: ["consumers", "consumer_groups", "jwt_secrets", "acls"],
  },
  {
    label: uiNavGroupTls,
    resources: ["certificates", "ca_certificates", "snis", "vaults"],
  },
];

function AppLayout(props: CoreLayoutProps) {
  const intl = useIntl();
  const pending = usePendingChanges();
  const count = pending.data?.changes.length ?? 0;
  // Edits happen on other pages: recount on every navigation.
  const { pathname } = useLocation();
  const { refetch } = pending;
  useEffect(() => {
    void pathname;
    void refetch();
  }, [pathname, refetch]);
  // The console pages are in the sidebar only; Publish carries the
  // unpublished count, and below 768 px, where the sidebar is a
  // drawer, the header's "N to publish" link.
  const groups = [
    {
      label: intl.formatMessage(uiNavGroupConsole),
      links: CONSOLE_PAGES.map((page) => ({
        to: page.path,
        label: intl.formatMessage(page.label),
        badge:
          page.path === PUBLISH_PATH
            ? {
                count,
                label: intl.formatMessage(
                  uiNavUnpublished as MessageDescriptor,
                  {
                    count,
                  },
                ),
              }
            : undefined,
      })),
    },
    ...SECTIONS.map((section) => ({
      label: intl.formatMessage(section.label),
      resources: section.resources,
    })),
  ];
  return (
    <KeyDialogProvider>
      <CommandPalette>
        <Layout
          {...props}
          sidebar={
            <GroupedSidebar sections={groups} footer={<IdentityFooter />} />
          }
          headerActions={
            <>
              <MobilePublishLink />
              <PaletteButton />
            </>
          }
        >
          <StagedBanner />
          <ViewerNotice />
          {props.children}
        </Layout>
      </CommandPalette>
    </KeyDialogProvider>
  );
}

// Built once: ra-core expects stable components per resource.
/** A plugin is edited in its schema form; the rest generically. */
function editPage(config: ResourceConfig) {
  const generic = makeEdit(config);
  if (config.name !== "plugins") return generic;
  return function PluginEdit() {
    return <PluginEditPage fallback={generic} />;
  };
}

// Credentials (key-auth, basic-auth) have no pages of their own: the admin
// API lists them only under a consumer, whose page manages them.
const PAGES = RESOURCES.map((config) => ({
  config,
  list: config.nested ? undefined : makeList(config),
  show: config.nested ? undefined : makeShow(config),
  edit: config.nested || config.noEdit ? undefined : editPage(config),
  create: config.nested ? undefined : makeCreate(config),
}));

// One client for ra-core and the app, so the role (useMe) is known where
// the resources are declared.
const queryClient = new QueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AdminApp />
    </QueryClientProvider>
  );
}

function AdminApp() {
  const intl = useIntl();
  // A viewer gets no create or edit pages, so the kit shows no buttons for
  // them; ViewerNotice says why.
  const canEdit = useCan("editor");
  // react-admin's strings from the catalog.
  const i18nProvider = useMemo(() => intlI18nProvider(intl), [intl]);
  // Real paths under /ui (the Worker answers deep links), not hash routes.
  return (
    <BrowserRouter basename={ADMIN_UI.basePath}>
      <Admin
        dataProvider={dataProvider}
        i18nProvider={i18nProvider}
        queryClient={queryClient}
        dashboard={OverviewPage}
        layout={AppLayout}
        title={intl.formatMessage(uiTitle)}
        disableTelemetry
        requireAuth={false}
      >
        <CustomRoutes>
          <Route path="/plugin-catalog" element={<PluginCatalogPage />} />
          <Route path="/plugin-catalog/:name" element={<PluginFormPage />} />
          <Route path="/publish" element={<PublishPage />} />
          <Route path="/tester" element={<TesterPage />} />
          <Route path="/audit" element={<AuditPage />} />
        </CustomRoutes>
        {PAGES.map(({ config, list, show, edit, create }) => (
          <Resource
            key={config.name}
            name={config.name}
            options={{ label: intl.formatMessage(config.label) }}
            list={list}
            show={show}
            edit={canEdit ? edit : undefined}
            create={canEdit ? create : undefined}
            recordRepresentation={
              config.represent ??
              (config.columns[0] === "id" ? undefined : config.columns[0])
            }
          />
        ))}
      </Admin>
    </BrowserRouter>
  );
}
