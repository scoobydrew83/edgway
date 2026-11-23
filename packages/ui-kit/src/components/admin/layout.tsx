import { AppSidebar } from "@edgway/ui-kit/components/admin/app-sidebar";
import { Error } from "@edgway/ui-kit/components/admin/error";
import { Loading } from "@edgway/ui-kit/components/admin/loading";
import { LocalesMenuButton } from "@edgway/ui-kit/components/admin/locales-menu-button";
import { Notification } from "@edgway/ui-kit/components/admin/notification";
import { RefreshButton } from "@edgway/ui-kit/components/admin/refresh-button";
import { ThemeModeToggle } from "@edgway/ui-kit/components/admin/theme-mode-toggle";
import { UserMenu } from "@edgway/ui-kit/components/admin/user-menu";
import {
  SidebarProvider,
  SidebarTrigger,
} from "@edgway/ui-kit/components/ui/sidebar";
import { cn } from "@edgway/ui-kit/lib/utils";
import type { CoreLayoutProps } from "ra-core";
import type { ErrorInfo, ReactNode } from "react";
import { Suspense, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";

/**
 * The main application layout with sidebar, header, and content area.
 *
 * Renders the app structure with a collapsible sidebar, header with breadcrumb navigation,
 * theme toggle, user menu, and main content area. Includes error boundary and loading states.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/layout/ Layout documentation}
 */
export const Layout = (
  props: CoreLayoutProps & {
    /** Extra controls in the header, before the theme toggle (Edgway: the ⌘K palette). */
    headerActions?: ReactNode;
    /** The sidebar, instead of AppSidebar (Edgway: grouped sections). */
    sidebar?: ReactNode;
  },
) => {
  const [errorInfo, setErrorInfo] = useState<ErrorInfo | undefined>(undefined);
  const handleError = (_: unknown, info: ErrorInfo) => {
    setErrorInfo(info);
  };
  return (
    <SidebarProvider>
      {props.sidebar ?? <AppSidebar />}
      <main
        className={cn(
          "ml-auto w-full max-w-full",
          "peer-data-[state=collapsed]:w-[calc(100%-var(--sidebar-width-icon)-1rem)]",
          "peer-data-[state=expanded]:w-[calc(100%-var(--sidebar-width))]",
          "sm:transition-[width] sm:duration-200 sm:ease-linear",
          "flex h-svh flex-col",
          "group-data-[scroll-locked=1]/body:h-full",
          "has-[main.fixed-main]:group-data-[scroll-locked=1]/body:h-svh",
        )}
      >
        <header className="flex h-16 md:h-12 shrink-0 items-center gap-2 px-4">
          <SidebarTrigger className="scale-125 sm:scale-100" />
          <div className="flex-1 flex items-center" id="breadcrumb" />
          {props.headerActions}
          <LocalesMenuButton />
          <ThemeModeToggle />
          <RefreshButton />
          <UserMenu />
        </header>
        <ErrorBoundary
          onError={handleError}
          fallbackRender={({ error, resetErrorBoundary }) => (
            <Error
              error={error}
              errorInfo={errorInfo}
              resetErrorBoundary={resetErrorBoundary}
            />
          )}
        >
          <Suspense fallback={<Loading />}>
            <div className="flex flex-1 flex-col px-4 ">{props.children}</div>
          </Suspense>
        </ErrorBoundary>
      </main>
      <Notification />
    </SidebarProvider>
  );
};
