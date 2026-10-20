import { useInstance } from "@/contexts/InstanceContext";
import { getInstanceTitle } from "@/lib/constants";
import { cn } from "@/lib/utils";
import UserAvatar from "./UserAvatar";

interface Props {
  className?: string;
  collapsed?: boolean;
  compact?: boolean;
  /** Scale of the compact lockup: "header" for primary chrome, "md" for roomy surfaces, and "sm" for dense menu rows. */
  size?: keyof typeof COMPACT_SCALE;
}

const COMPACT_SCALE = {
  md: { mark: "size-7 rounded-[7px]", gap: "gap-1.5", title: "text-[14px]", weight: "font-medium" },
  header: { mark: "size-6 rounded-[6px]", gap: "gap-2", title: "text-[15px] leading-5", weight: "font-semibold" },
  sm: { mark: "size-5 rounded-[5px]", gap: "gap-1.5", title: "text-ui", weight: "font-medium" },
} as const;

export const NoterMark = ({ className }: { className?: string }) => (
  <img src="/noter-icon-v2.png" alt="" aria-hidden="true" className={cn("size-full select-none object-contain", className)} />
);

export function NoterLogo(props: Props) {
  const { collapsed, compact, size = "md" } = props;
  const scale = COMPACT_SCALE[size];
  const { generalSetting: instanceGeneralSetting } = useInstance();
  const title = getInstanceTitle(instanceGeneralSetting.customProfile?.title);
  const customLogoUrl = instanceGeneralSetting.customProfile?.logoUrl;
  const hasCustomLogo = Boolean(customLogoUrl && customLogoUrl !== "/full-logo.webp" && customLogoUrl !== "/logo.webp");

  return (
    <div className={cn("relative min-w-0 h-auto", props.className)}>
      <div
        className={cn(
          "flex min-w-0 flex-row items-center justify-start text-foreground",
          compact ? cn("px-0", scale.gap) : collapsed ? "px-1" : "gap-2 px-3",
        )}
      >
        {hasCustomLogo ? (
          <UserAvatar className={cn("shrink-0", compact ? scale.mark : "rounded-xl")} avatarUrl={customLogoUrl} />
        ) : (
          <div className={cn("shrink-0 overflow-hidden flex items-center justify-center", compact ? scale.mark : "size-8 rounded-xl")}>
            <NoterMark />
          </div>
        )}
        {!collapsed && (
          <span
            className={cn(
              "shrink truncate text-foreground",
              compact ? cn(scale.title, scale.weight, "tracking-[-0.01em]") : "text-lg font-medium",
            )}
          >
            {title}
          </span>
        )}
      </div>
    </div>
  );
}

export default NoterLogo;
