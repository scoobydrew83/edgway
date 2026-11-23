/**
 * The ⌘K palette (cmdk, through the kit's shadcn Command): jump to a console
 * page or any entity list, or start creating one. One dialog, opened by ⌘K,
 * the sidebar's "Jump to…" or the header's search button.
 */
import {
  uiPaletteCreate,
  uiPaletteCreateItem,
  uiPaletteEmpty,
  uiPaletteGoTo,
  uiPaletteHint,
  uiPaletteJump,
  uiPalettePlaceholder,
  uiPaletteShortcut,
} from "@edgway/i18n/messages";
import { Button } from "@edgway/ui-kit/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@edgway/ui-kit/components/ui/command";
import { SearchIcon } from "lucide-react";
import { useCreatePath } from "ra-core";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { type MessageDescriptor, useIntl } from "react-intl";
import { useNavigate } from "react-router";
import { CONSOLE_PAGES } from "./console/nav";
import { RESOURCES } from "./resources";

/** ⌘K on macOS, Ctrl+K elsewhere. */
const SHORTCUT = "k";

const PaletteContext = createContext<(open: boolean) => void>(() => {});

/** Opens the palette: the header's search or the sidebar's "Jump to…". */
export function PaletteButton({ sidebar = false }: { sidebar?: boolean }) {
  const intl = useIntl();
  const setOpen = useContext(PaletteContext);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setOpen(true)}
      className={
        sidebar
          ? "w-full justify-start border-sidebar-border bg-transparent text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          : undefined
      }
    >
      <SearchIcon />
      {intl.formatMessage(sidebar ? uiPaletteJump : uiPaletteHint)}
      <CommandShortcut>{intl.formatMessage(uiPaletteShortcut)}</CommandShortcut>
    </Button>
  );
}

export function CommandPalette({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const intl = useIntl();
  const navigate = useNavigate();
  const createPath = useCreatePath();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === SHORTCUT && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const go = (resource: string, type: "list" | "create") => {
    setOpen(false);
    navigate(createPath({ resource, type }));
  };

  return (
    <PaletteContext.Provider value={setOpen}>
      {children}
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder={intl.formatMessage(uiPalettePlaceholder)} />
        <CommandList>
          <CommandEmpty>{intl.formatMessage(uiPaletteEmpty)}</CommandEmpty>
          <CommandGroup heading={intl.formatMessage(uiPaletteGoTo)}>
            {CONSOLE_PAGES.map((page) => (
              <CommandItem
                key={page.path}
                onSelect={() => {
                  setOpen(false);
                  navigate(page.path);
                }}
              >
                {intl.formatMessage(page.label)}
              </CommandItem>
            ))}
            {RESOURCES.filter((r) => !r.nested).map((r) => (
              <CommandItem key={r.name} onSelect={() => go(r.name, "list")}>
                {intl.formatMessage(r.label)}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading={intl.formatMessage(uiPaletteCreate)}>
            {RESOURCES.map((r) => (
              <CommandItem
                key={`create-${r.name}`}
                onSelect={() => go(r.name, "create")}
              >
                {intl.formatMessage(uiPaletteCreateItem as MessageDescriptor, {
                  resource: intl.formatMessage(r.label),
                })}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </PaletteContext.Provider>
  );
}
