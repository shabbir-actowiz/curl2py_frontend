export const apiRoutes = {
  register: "/api/v1/auth/register",
  login: "/api/v1/auth/login",
  refresh: "/api/v1/auth/refresh",
  me: "/api/v1/auth/me",
  convert: "/api/v1/convert",
  runWorkspace: "/run-workspace",
  history: "/api/v1/history",
  deleteHistory: (id: string) => `/api/v1/history/${id}`,
  health: "/health",
} as const;
