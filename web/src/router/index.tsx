import { Suspense } from "react";
import { createBrowserRouter, Navigate, type RouteObject } from "react-router-dom";
import App from "@/App";
import { ChunkLoadErrorFallback } from "@/components/ErrorBoundary";
import { useAuth } from "@/contexts/AuthContext";
import MainLayout from "@/layouts/MainLayout";
import RootLayout from "@/layouts/RootLayout";
import { lazyWithReload } from "@/utils/lazy";
import { RequireAuthRoute, RequireFullInitializationRoute, RequireGuestRoute, RequireInstanceInitializationRoute } from "./guards";
import { ROUTES } from "./routes";

const AdminSignIn = lazyWithReload(() => import("@/pages/AdminSignIn"));
const About = lazyWithReload(() => import("@/pages/About"));
const Archived = lazyWithReload(() => import("@/pages/Archived"));
const AuthCallback = lazyWithReload(() => import("@/pages/AuthCallback"));
const Home = lazyWithReload(() => import("@/pages/Home"));
const MemoDetail = lazyWithReload(() => import("@/pages/MemoDetail"));
const NotFound = lazyWithReload(() => import("@/pages/NotFound"));
const PermissionDenied = lazyWithReload(() => import("@/pages/PermissionDenied"));
const Attachments = lazyWithReload(() => import("@/pages/Attachments"));
const Setting = lazyWithReload(() => import("@/pages/Setting"));
const SignIn = lazyWithReload(() => import("@/pages/SignIn"));
const SignUp = lazyWithReload(() => import("@/pages/SignUp"));

const HomeRoute = () => {
  const { isIdentityInitialized } = useAuth();
  if (!isIdentityInitialized) return null;
  return (
    <Suspense
      fallback={
        <p className="p-6 text-sm text-muted-foreground" role="status">
          Opening your notes…
        </p>
      }
    >
      <Home />
    </Suspense>
  );
};

// Backward compatibility alias.
export const Routes = ROUTES;
export { ROUTES };

/**
 * Static route configuration. Exported so tests can assert on the tree shape
 * (e.g. that `/auth/callback` stays outside the guest-only guard subtree) and
 * so integration tests can drive a `createMemoryRouter` over the same tree.
 */
export const routeConfig: RouteObject[] = [
  {
    path: "/",
    element: <App />,
    errorElement: <ChunkLoadErrorFallback />,
    children: [
      {
        path: Routes.AUTH,
        children: [
          // The OAuth callback must run regardless of the current session — an
          // authenticated tab elsewhere must not block it from consuming its
          // one-time OAuth state. Keep it outside the guest-only subtree.
          { path: "callback", element: <AuthCallback /> },
          {
            element: <RequireInstanceInitializationRoute />,
            children: [
              {
                element: <RequireGuestRoute />,
                children: [
                  { path: "", element: <SignIn /> },
                  { path: "admin", element: <AdminSignIn /> },
                  { path: "signup", element: <SignUp /> },
                ],
              },
            ],
          },
        ],
      },
      // Backward compatibility: the old `/home` URL now lives at `/`.
      { path: "home", element: <Navigate to={Routes.HOME} replace /> },
      {
        element: <RootLayout />,
        children: [
          { index: true, element: <HomeRoute /> },
          {
            element: <MainLayout />,
            children: [
              {
                element: <RequireInstanceInitializationRoute />,
                children: [{ path: Routes.ABOUT, element: <About /> }],
              },
            ],
          },
          { element: <RequireAuthRoute />, children: [{ path: Routes.ARCHIVED, element: <Archived /> }] },
          { path: "memos/:uid", element: <MemoDetail /> },
          {
            element: <RequireAuthRoute />,
            children: [
              {
                element: <RequireFullInitializationRoute />,
                children: [
                  { path: Routes.ATTACHMENTS, element: <Attachments /> },
                  { path: Routes.SETTING, element: <Setting /> },
                ],
              },
            ],
          },
          { path: "403", element: <PermissionDenied /> },
          { path: "404", element: <NotFound /> },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
];

const router = createBrowserRouter(routeConfig);

export default router;
