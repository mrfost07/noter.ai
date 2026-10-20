import { useDirection } from "@base-ui/react/direction-provider";
import {
  ArrowRightIcon,
  FileAudioIcon,
  FileTextIcon,
  HeadphonesIcon,
  ImageIcon,
  LibraryIcon,
  ListIcon,
  type LucideIcon,
  MenuIcon,
  PaperclipIcon,
  SearchIcon,
  SparklesIcon,
  SquarePenIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import AgentSheet from "@/components/AgentSheet/AgentSheet";
import MemoDisplaySettingMenu from "@/components/MemoDisplaySettingMenu";
import NoterLogo from "@/components/NoterLogo";
import { DEFAULT_SETTING_SECTION, SETTINGS_SECTIONS } from "@/components/Settings/settingSections";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { type AttachmentSection, useAppSidebar } from "@/contexts/AppSidebarContext";
import { useAuth } from "@/contexts/AuthContext";
import { useGlobalMemoEditor } from "@/contexts/GlobalMemoEditorContext";
import { useInstance } from "@/contexts/InstanceContext";
import { useMeetingCompanion } from "@/contexts/MeetingCompanionContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useFilteredMemoStats } from "@/hooks/useFilteredMemoStats";
import useMediaQuery from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { collectionNavigationPath, ROUTES } from "@/router/routes";
import { User_Role } from "@/types/proto/api/user_service_pb";
import { useTranslate } from "@/utils/i18n";
import CommonSidebarContent from "./CommonSidebarContent";
import { getSidebarRouteKind } from "./routes";
import SidebarRow, { SIDEBAR_ROW_CLASSES, SIDEBAR_ROW_FOCUS_CLASSES, SidebarRowIconSlot, sidebarRowStateClasses } from "./SidebarRow";
import SidebarSection, { SIDEBAR_SECTION_STACK_CLASSES } from "./SidebarSection";
import {
  SIDEBAR_LEADING_SLOT_CLASSES,
  SIDEBAR_NAV_LEADING_SLOT_CLASSES,
  SIDEBAR_RAIL_CLASSES,
  sidebarSurfaceVariants,
} from "./sidebar-layout";
import TagsSection from "./TagsSection";

const NewMemoAction = ({ onClick }: { onClick: () => void }) => {
  const t = useTranslate();
  const label = t("editor.new-memo");

  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="outline" size="icon-compact" onClick={onClick} aria-label={label} data-new-memo-trigger />}>
        <SquarePenIcon className="size-4" strokeWidth={1.8} />
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
};

const AIAgentAction = ({ onClick }: { onClick: () => void }) => {
  const label = "AI Agent";

  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="outline" size="icon-compact" onClick={onClick} aria-label={label} data-ai-agent-trigger />}>
        <SparklesIcon className="size-4" strokeWidth={1.8} />
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
};

const MeetingCompanionAction = ({ onClick }: { onClick: () => void }) => {
  const label = "Meeting Companion (Zoom / Meet / Slack)";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="outline" size="icon-compact" onClick={onClick} aria-label={label} data-meeting-companion-trigger>
            <HeadphonesIcon className="size-4" strokeWidth={1.8} />
          </Button>
        }
      />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
};

/** Collection sidebar content */
const CollectionSidebarContent = ({ context }: { context: "home" | "archived" }) => {
  const md = useMediaQuery("md");
  const { mobileOpen, setMobileOpen } = useAppSidebar();
  const { isInitialized: authInitialized } = useAuth();
  const { isInitialized: instanceInitialized } = useInstance();
  const { tags } = useFilteredMemoStats({
    context: context === "archived" ? "archived" : "collection",
    filter: undefined,
    enabled: authInitialized && instanceInitialized && (md || mobileOpen),
  });

  return (
    <div className={SIDEBAR_SECTION_STACK_CLASSES}>
      <TagsSection tagCount={tags} scope={context} onSelect={() => setMobileOpen(false)} />
    </div>
  );
};

const AttachmentsSidebarContent = () => {
  const t = useTranslate();
  const { attachmentSection, setAttachmentSection, setMobileOpen } = useAppSidebar();
  const rows: Array<{ value: AttachmentSection; icon: LucideIcon; label: string }> = [
    { value: "all", icon: ListIcon, label: t("common.all") },
    { value: "media", icon: ImageIcon, label: t("attachment-library.tabs.media") },
    { value: "audio", icon: FileAudioIcon, label: t("attachment-library.tabs.audio") },
    {
      value: "documents",
      icon: FileTextIcon,
      label: t("attachment-library.tabs.documents"),
    },
    {
      value: "unused",
      icon: Trash2Icon,
      label: t("attachment-library.labels.unused"),
    },
  ];
  return (
    <SidebarSection label={t("common.attachments")}>
      {rows.map((row) => (
        <SidebarRow
          key={row.value}
          state={attachmentSection === row.value ? "current" : "idle"}
          icon={row.icon}
          label={row.label}
          onClick={() => {
            setAttachmentSection(row.value);
            setMobileOpen(false);
          }}
        />
      ))}
    </SidebarSection>
  );
};

const SettingsSidebarContent = () => {
  const t = useTranslate();
  const location = useLocation();
  const user = useCurrentUser();
  const { setMobileOpen } = useAppSidebar();
  const isHost = user?.role === User_Role.ADMIN;
  const currentSection = location.hash.slice(1) || DEFAULT_SETTING_SECTION;
  const essential = new Set(["my-account", "preference", "ai", "memo-export"]);
  const basic = SETTINGS_SECTIONS.filter((section) => essential.has(section.key) && (section.scope === "basic" || isHost));
  const admin = SETTINGS_SECTIONS.filter((section) => !essential.has(section.key) && (section.scope === "basic" || isHost));
  const renderSections = (sections: typeof SETTINGS_SECTIONS) =>
    sections.map((section) => (
      <Link
        key={section.key}
        to={`${ROUTES.SETTING}#${section.key}`}
        onClick={() => setMobileOpen(false)}
        className={cn(SIDEBAR_ROW_CLASSES, sidebarRowStateClasses(currentSection === section.key ? "current" : "idle"))}
      >
        <SidebarRowIconSlot icon={section.icon} />
        <span className="truncate">{t(section.labelKey)}</span>
      </Link>
    ));
  return (
    <div className={SIDEBAR_SECTION_STACK_CLASSES}>
      <SidebarSection label={t("common.basic")}>{renderSections(basic)}</SidebarSection>
      <details open={admin.some((section) => section.key === currentSection)}>
        <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">Workspace settings</summary>
        <SidebarSection>{renderSections(admin)}</SidebarSection>
      </details>
    </div>
  );
};

const MemoDetailSidebarContent = () => {
  return null;
};

const RouteSidebarContent = () => {
  const location = useLocation();
  const kind = getSidebarRouteKind(location.pathname);
  if (kind === "home" || kind === "archived") {
    return <CollectionSidebarContent context={kind} />;
  }
  if (kind === "attachments") return <AttachmentsSidebarContent />;
  if (kind === "settings") return <SettingsSidebarContent />;
  if (kind === "memo") return <MemoDetailSidebarContent />;
  if (kind === "common") return <CommonSidebarContent />;
  return null;
};

/** Collection views beside Timeline. */
const NAV_DESTINATIONS = [
  { kind: "attachments", labelKey: "common.attachments", pathname: ROUTES.ATTACHMENTS, icon: PaperclipIcon, signedInOnly: true },
] as const;

interface NavPillProps {
  label: string;
  icon: LucideIcon;
  /** A link when set; otherwise a button that runs `onClick`. */
  to?: string;
  onClick?: () => void;
  active?: boolean;
  expanded?: boolean;
  className?: string;
}

/**
 * The compact navigator is intentionally horizontal. Its 16px glyph plus 6px padding
 * on each side makes the collapsed control an exact 28px square, the same box as the
 * header's compose control. Expanding the label only opens the text track, so the
 * artwork and surface never jump.
 *
 * Actions are separated by 4px; icons and labels by 6px. Below a 230px row the current
 * page stays a filled square with its tooltip, leaving room for the other actions.
 * Timeline's trailing arrow shares its surface, with a separate click target.
 */
const NavPill = ({ label, icon: Icon, to, onClick, active = false, expanded = false, className }: NavPillProps) => {
  const { setMobileOpen } = useAppSidebar();
  const props = {
    onClick: () => {
      setMobileOpen(false);
      onClick?.();
    },
    "aria-label": label,
    "aria-current": active ? ("page" as const) : undefined,
    className: cn(
      sidebarSurfaceVariants({ role: "navPill" }),
      SIDEBAR_ROW_FOCUS_CLASSES,
      sidebarRowStateClasses(active ? "current" : "idle"),
      className,
    ),
  };
  return (
    <Tooltip disabled={expanded}>
      <TooltipTrigger render={to ? <Link to={to} {...props} /> : <button type="button" {...props} />}>
        <span className={SIDEBAR_NAV_LEADING_SLOT_CLASSES} aria-hidden="true">
          <Icon className="size-4 opacity-75" strokeWidth={1.8} />
        </span>
        {/* The control carries its own aria-label; this text is decoration whether or not it is open. */}
        <span
          aria-hidden="true"
          className={cn(
            "grid min-w-0 grid-cols-[0fr] ps-0 transition-[grid-template-columns,padding] duration-200 ease-out motion-reduce:transition-none",
            expanded && "@min-[230px]:grid-cols-[1fr] @min-[230px]:ps-1.5",
          )}
        >
          <span className="flex min-w-0 items-center overflow-hidden">
            <span data-sidebar-label className="shrink-0 truncate text-[12px] leading-5">
              {label}
            </span>
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
};

const GlobalNavigation = () => {
  const t = useTranslate();
  const timelineRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const currentUser = useCurrentUser();
  const { setQuickFindOpen } = useAppSidebar();
  const routeKind = getSidebarRouteKind(location.pathname);
  const timelineActive = routeKind === "home";
  const destinations = NAV_DESTINATIONS.filter((destination) => currentUser || !destination.signedInOnly);
  // The current page shows its label; anywhere else, Timeline does.
  const expandedKind = destinations.find((destination) => destination.kind === routeKind)?.kind ?? "timeline";
  const navigationPath = (pathname: string) => collectionNavigationPath(pathname, location, currentUser?.username);

  return (
    <TooltipProvider>
      <nav className={cn("@container flex h-7 items-center gap-1", SIDEBAR_RAIL_CLASSES)} aria-label="Primary">
        <div ref={timelineRef} className={cn("flex shrink-0 items-center rounded-md", timelineActive && sidebarRowStateClasses("current"))}>
          <NavPill
            to={navigationPath(ROUTES.HOME)}
            label={t("common.timeline")}
            icon={LibraryIcon}
            active={timelineActive}
            expanded={expandedKind === "timeline"}
            className={cn(timelineActive && "rounded-e-none pe-0")}
          />
          {timelineActive && <MemoDisplaySettingMenu anchor={timelineRef} />}
        </div>
        {destinations.map((destination) => (
          <NavPill
            key={destination.kind}
            to={navigationPath(destination.pathname)}
            label={t(destination.labelKey)}
            icon={destination.icon}
            active={destination.kind === routeKind}
            expanded={destination.kind === expandedKind}
          />
        ))}
        <NavPill label={t("common.search")} icon={SearchIcon} onClick={() => setQuickFindOpen(true)} className="ms-auto" />
      </nav>
    </TooltipProvider>
  );
};

const AppSidebar = ({ className }: { className?: string }) => {
  const t = useTranslate();
  const currentUser = useCurrentUser();
  const { setMobileOpen } = useAppSidebar();
  const { canOpen: canCompose, openEditor } = useGlobalMemoEditor();
  const { enterMeetingMode } = useMeetingCompanion();
  const [agentOpen, setAgentOpen] = useState(false);

  return (
    <aside className={cn("flex h-full w-full select-none flex-col bg-sidebar text-sidebar-foreground", className)}>
      <div data-sidebar-header className={cn("flex h-13 shrink-0 items-center justify-between gap-2", SIDEBAR_RAIL_CLASSES)}>
        <NoterLogo className="min-w-0" size="header" compact />
        <div className="flex shrink-0 items-center gap-1">
          {currentUser && <MeetingCompanionAction onClick={() => void enterMeetingMode()} />}
          {currentUser && <AIAgentAction onClick={() => setAgentOpen(true)} />}
          {canCompose && <NewMemoAction onClick={openEditor} />}
        </div>
      </div>
      <GlobalNavigation />
      <div className="mx-3 mt-2 border-t border-border/70" />
      <div className={cn("min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-2 pb-3 [scrollbar-width:thin]", SIDEBAR_RAIL_CLASSES)}>
        <RouteSidebarContent />
      </div>
      {currentUser && <AgentSheet open={agentOpen} onOpenChange={setAgentOpen} />}
      {!currentUser && (
        <footer className="shrink-0 border-t border-border/70">
          <Link
            to={ROUTES.AUTH}
            onClick={() => setMobileOpen(false)}
            className={cn(
              sidebarSurfaceVariants({ role: "account" }),
              "group text-[13px] font-medium text-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
            )}
          >
            <span className={SIDEBAR_LEADING_SLOT_CLASSES}>
              <UserRoundIcon className="me-auto size-4 text-muted-foreground" strokeWidth={1.8} />
            </span>
            <span data-sidebar-label className="min-w-0 flex-1 truncate">
              {t("common.sign-in-to-memos")}
            </span>
            <ArrowRightIcon
              data-sidebar-trailing
              className="size-3.5 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
              strokeWidth={1.8}
            />
          </Link>
        </footer>
      )}
    </aside>
  );
};

export const MobileAppHeader = () => {
  const { setMobileOpen } = useAppSidebar();
  return (
    <header className="sticky top-0 z-20 flex h-12 w-full shrink-0 items-center justify-start gap-1 border-b border-border/70 bg-background/90 px-2 backdrop-blur-md md:hidden">
      <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Open navigation" data-mobile-navigation-trigger>
        <MenuIcon className="size-[18px]" />
      </Button>
      <NoterLogo className="max-w-[12rem]" size="md" compact />
    </header>
  );
};

export const MobileAppSidebar = () => {
  const direction = useDirection();
  const { mobileOpen, setMobileOpen, completeMobileClose } = useAppSidebar();
  return (
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen} onOpenChangeComplete={completeMobileClose}>
      <SheetContent
        side={direction === "rtl" ? "right" : "left"}
        className="w-[min(18rem,calc(100vw-2rem))] gap-0 border-border p-0 shadow-2xl [&>[data-slot=sheet-close]]:sr-only"
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <AppSidebar />
      </SheetContent>
    </Sheet>
  );
};

export default AppSidebar;
