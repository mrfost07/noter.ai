import { matchPath } from "react-router-dom";

export const ROUTES = {
  HOME: "/",
  ABOUT: "/about",
  ATTACHMENTS: "/attachments",
  ARCHIVED: "/archived",
  SETTING: "/setting",
  MEMO_DETAIL: "/memos/:uid",
  AUTH: "/auth",
  AUTH_SIGNUP: "/auth/signup",
  AUTH_ADMIN: "/auth/admin",
  AUTH_CALLBACK: "/auth/callback",
} as const;

export type RouteKey = keyof typeof ROUTES;
export type RoutePath = (typeof ROUTES)[RouteKey];

/** Collection pages that exist in the app. */
const COLLECTION_ROUTE_PATTERNS = [ROUTES.HOME, ROUTES.ATTACHMENTS];

const isCollectionPathname = (pathname: string): boolean =>
  COLLECTION_ROUTE_PATTERNS.some((path) => matchPath({ path, caseSensitive: false }, pathname) !== null);

export interface CollectionRoute {
  pathname: string;
  isCollection: boolean;
}

export const resolveCollectionRoute = (path: string): CollectionRoute => {
  const pathname = (path.split(/[?#]/, 1)[0] || ROUTES.HOME).replace(/\/+$/, "") || ROUTES.HOME;
  return { pathname, isCollection: isCollectionPathname(pathname) };
};

export const buildCollectionPath = (pathname: string): string => {
  const route = resolveCollectionRoute(pathname);
  return route.pathname;
};

export const collectionPathForLocation = (pathname: string, _currentPath: string): string => buildCollectionPath(pathname);

export const getCollectionCreator = (search: string): string | undefined => {
  const username = new URLSearchParams(search).get("creator");
  return username || undefined;
};

export const withCollectionCreator = (search: string, username?: string): string => {
  const params = new URLSearchParams(search);
  if (username) params.set("creator", username);
  else params.delete("creator");
  const query = params.toString();
  return query ? `?${query}` : "";
};

export const getCreatorHomePath = (username: string): string => `${ROUTES.HOME}${withCollectionCreator("", username)}`;

export const getCollectionHomePath = (_location: { pathname: string; search: string }): string => {
  return ROUTES.HOME;
};

export const collectionNavigationPath = (
  pathname: string,
  location: { pathname: string; search: string },
  _currentUsername?: string,
): string => {
  const route = resolveCollectionRoute(location.pathname);
  const filter = route.isCollection ? new URLSearchParams(location.search).get("filter") : null;
  const search = filter ? new URLSearchParams({ filter }).toString() : "";
  return search ? `${pathname}?${search}` : pathname;
};

export const getCreatorSwitchPath = (
  location: { pathname: string; search: string; hash?: string },
  username?: string,
  _currentUsername?: string,
): string => {
  return `${location.pathname}${withCollectionCreator(location.search, username)}${location.hash || ""}`;
};

export const getSpaceSwitchPath = (location: { pathname: string; search: string; hash?: string }, _spaceName?: string): string => {
  return `${location.pathname}${location.search}${location.hash || ""}`;
};
