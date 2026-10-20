import { ROUTES, resolveCollectionRoute } from "@/router/routes";

export type MemoScope = "home" | "archived";

export const getMemoViewId = (name: string): string => {
  const parts = name.split("/");
  return parts.length === 4 ? parts[3] : name;
};

const cleanPathname = (value: string): string => {
  const pathname = value.split(/[?#]/, 1)[0] || ROUTES.HOME;
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
};

/** Lower-cased global pathname. */
const comparablePathname = (pathname: string): string => resolveCollectionRoute(pathname).pathname.toLowerCase();

export const isMemoScopeRoute = (pathname: string): boolean => {
  const comparablePath = comparablePathname(pathname);
  return comparablePath === ROUTES.HOME || comparablePath === ROUTES.ARCHIVED;
};

export const isMemoCollectionRoute = (pathname: string): boolean => isMemoScopeRoute(pathname);

interface ResolveMemoScopeOptions {
  detailFrom?: string;
  memoArchived?: boolean;
  fallback?: MemoScope;
}

export const resolveMemoScope = (pathname: string, options: ResolveMemoScopeOptions = {}): MemoScope => {
  const cleanPath = cleanPathname(pathname);
  const comparablePath = comparablePathname(cleanPath);
  if (comparablePath === ROUTES.ARCHIVED) return "archived";
  if (comparablePath === ROUTES.HOME) return "home";

  if (comparablePath.startsWith("/memos/") && options.detailFrom) {
    return resolveMemoScope(options.detailFrom, {
      fallback: options.fallback,
    });
  }

  if (comparablePath.startsWith("/memos/") && options.memoArchived) {
    return "archived";
  }

  return options.fallback ?? "home";
};
