/**
 * The admin UI's sidebar (the design's Sidebar component):
 * full height and dark, the name, "Jump to…", then labelled sections, the
 * console pages first (the header has none of them), then the entities by
 * area, with the signed-in identity pinned to the bottom. Items carry no
 * icons. Built from ui-kit's sidebar primitives; ui-kit's Layout takes it in
 * its `sidebar` slot.
 */
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@edgway/ui-kit/components/ui/sidebar";
import { Shell } from "lucide-react";
import {
  LinkBase,
  useCreatePath,
  useDefaultTitle,
  useGetResourceLabel,
  useMatch,
  useResourceDefinitions,
} from "ra-core";
import type { ReactNode } from "react";
import { PaletteButton } from "./palette";

interface SidebarLink {
  to: string;
  label: string;
  /** A count beside the label (the Publish item's unpublished changes). */
  badge?: { count: number; label: string };
}

export interface SidebarSection {
  label: string;
  links?: SidebarLink[];
  /** Entity lists; one not named in any section isn't in the sidebar (targets live on their upstream's page). */
  resources?: string[];
}

/** One item, active on its path and below it. */
function MenuLink({
  to,
  label,
  badge,
  end,
  onClick,
}: SidebarLink & { end: boolean; onClick: () => void }) {
  const match = useMatch({ path: to, end });
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<LinkBase to={to} onClick={onClick} />}
        isActive={!!match}
      >
        {label}
      </SidebarMenuButton>
      {badge && badge.count > 0 ? (
        <SidebarMenuBadge
          data-testid="sidebar-unpublished"
          aria-label={badge.label}
          className="rounded-full bg-warning text-warning-foreground peer-hover/menu-button:text-warning-foreground peer-data-active/menu-button:text-warning-foreground"
        >
          {badge.count}
        </SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  );
}

export function GroupedSidebar({
  sections,
  footer,
}: {
  sections: SidebarSection[];
  /** Below the sections: the signed-in identity. */
  footer?: ReactNode;
}) {
  const title = useDefaultTitle();
  const resources = useResourceDefinitions();
  const getResourceLabel = useGetResourceLabel();
  const createPath = useCreatePath();
  const { openMobile, setOpenMobile } = useSidebar();
  const close = () => {
    if (openMobile) setOpenMobile(false);
  };
  return (
    <Sidebar variant="sidebar" collapsible="offcanvas">
      <SidebarHeader className="gap-4 p-4">
        <LinkBase
          to="/"
          className="flex items-center gap-2 text-lg font-semibold text-sidebar-foreground"
        >
          <Shell className="size-6 text-sidebar-primary" aria-hidden />
          {title}
        </LinkBase>
        <PaletteButton sidebar />
      </SidebarHeader>
      <SidebarContent>
        {sections.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/60">
              {section.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {(section.links ?? []).map((link) => (
                  <MenuLink
                    key={link.to}
                    {...link}
                    end={link.to === "/"}
                    onClick={close}
                  />
                ))}
                {(section.resources ?? [])
                  .filter((name) => resources[name]?.hasList)
                  .map((name) => (
                    <MenuLink
                      key={name}
                      to={createPath({ resource: name, type: "list" })}
                      label={getResourceLabel(name, 2)}
                      end={false}
                      onClick={close}
                    />
                  ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      {footer ? (
        <SidebarFooter className="border-t border-sidebar-border p-4">
          {footer}
        </SidebarFooter>
      ) : null}
    </Sidebar>
  );
}
