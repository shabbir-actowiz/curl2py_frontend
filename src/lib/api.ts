import { apiRoutes } from "./api-routes";

export interface UserCreate {
  username: string;
  email: string;
  password: string;
}

export interface UserLogin {
  username: string;
  password: string;
}

export interface UserResponse {
  id: string;
  username: string;
  email: string;
  scopes: string[];
  created_at: string;
}

export interface MessageResponse {
  message: string;
}

export interface Token {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface TokenRefresh {
  refresh_token: string;
}

export interface GoogleLoginRequest {
  credential: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
}

export interface CurlRequest {
  curl: string;
  function_name?: string | null;
  snippet_id?: string | null;
  name?: string | null;
}

export interface ConvertRequest {
  collection_id?: string;
  collection_name?: string;
  library?: string;
  curl?: string | CurlRequest | null;
  commands?: Array<string | CurlRequest> | null;
  function_name_prefix?: string | null;
  proxy?: ProxyConfig | null;
  idempotency_key?: string | null;
  persist?: boolean | null;
}

export interface ConversionResponse {
  success: boolean;
  python_code?: string | null;
  parser_code?: string | null;
  function_name?: string | null;
  request_script?: string | null;
  parser_script?: string | null;
  function_names: string[];
  error?: string | null;
  error_type?: string | null;
  meta?: Record<string, unknown> | null;
}

export interface RunWorkspaceRequest {
  collection_name?: string;
  workspace_name: string;
  request_code: string;
  parser_code: string;
  proxy?: ProxyConfig | null;
}

export interface ProxyConfig {
  enabled: boolean;
  url: string;
}

export interface UserWorkspaceState {
  collections: Record<string, unknown>;
  activeCollectionId?: string | null;
  theme: string;
  openResponseTabs?: Array<Record<string, unknown>>;
  activeResponseTabId?: string | null;
  updatedAt?: string | null;
}

export interface RenameCollectionConversionsRequest {
  collection_name: string;
}

export interface RunWorkspaceResponse {
  success: boolean;
  workspace_name: string;
  status: number | null;
  time_ms: number;
  size: string;
  content_type: string;
  extension: string;
  response_file_name?: string | null;
  file_name?: string | null;
  response: unknown | null;
  parsed: unknown | null;
  logs: string;
  error?: string | null;
}

export interface RunParserRequest {
  response_content: string;
  response_type: "html" | "json";
  parser_code: string;
  parser_function_name: string;
}

export interface RunParserResponse {
  success: boolean;
  output: unknown | null;
  output_file_name?: string | null;
  error?: string | null;
}

export interface ConversionHistory {
  _id: string;
  user_id: string;
  curl_command: string;
  python_code?: string | null;
  parser_code?: string | null;
  function_names: string[];
  status: string;
  error_message?: string | null;
  request_type: string;
  created_at: string;
}

export interface HealthResponse {
  status: string;
  version: string;
  db?: string;
  service?: string;
}

const DEFAULT_API_BASE_URL = "";

export const API_BASE_URL = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, message: string, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

function buildUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (!API_BASE_URL) {
    return normalizedPath;
  }

  const base = API_BASE_URL.endsWith("/") ? API_BASE_URL : `${API_BASE_URL}/`;
  return new URL(normalizedPath.replace(/^\/+/, ""), base).toString();
}

function describeValidationError(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const error = value as { loc?: unknown; msg?: unknown };
  const location = Array.isArray(error.loc) ? error.loc.join(".") : "";
  const message = typeof error.msg === "string" ? error.msg : "";

  if (location && message) {
    return `${location}: ${message}`;
  }

  return message;
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const candidate = payload as { detail?: unknown; error?: unknown; message?: unknown };

    if (typeof candidate.detail === "string" && candidate.detail.trim()) {
      return candidate.detail;
    }

    if (Array.isArray(candidate.detail)) {
      const messages = candidate.detail.map(describeValidationError).filter(Boolean);
      if (messages.length > 0) {
        return messages.join("; ");
      }
    }

    if (typeof candidate.error === "string" && candidate.error.trim()) {
      return candidate.error;
    }

    if (typeof candidate.message === "string" && candidate.message.trim()) {
      return candidate.message;
    }
  }

  return fallback;
}

async function request<T>(path: string, init: RequestInit = {}, accessToken?: string, signal?: AbortSignal): Promise<T> {
  const headers = new Headers(init.headers);

  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const body = init.body;
  if (typeof body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (body instanceof URLSearchParams && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8");
  }

  const response = await fetch(buildUrl(path), {
    ...init,
    headers,
    signal,
  });

  const contentType = response.headers.get("content-type") ?? "";
  let payload: unknown = undefined;

  if (response.status !== 204) {
    if (contentType.includes("application/json")) {
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
    } else {
      payload = await response.text();
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, extractErrorMessage(payload, `Request failed with status ${response.status}`), payload);
  }

  return payload as T;
}

export function extractApiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return "Request failed";
}

export async function registerUser(payload: UserCreate): Promise<UserResponse> {
  return request<UserResponse>(apiRoutes.register, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function loginUser(payload: UserLogin): Promise<Token> {
  return request<Token>(apiRoutes.login, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function loginWithGoogle(payload: GoogleLoginRequest): Promise<Token> {
  return request<Token>(apiRoutes.googleLogin, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function forgotPassword(payload: ForgotPasswordRequest): Promise<MessageResponse> {
  return request<MessageResponse>(apiRoutes.forgotPassword, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function resetPassword(payload: ResetPasswordRequest): Promise<MessageResponse> {
  return request<MessageResponse>(apiRoutes.resetPassword, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function refreshUserSession(payload: TokenRefresh): Promise<Token> {
  return request<Token>(apiRoutes.refresh, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getCurrentUser(accessToken: string): Promise<UserResponse> {
  return request<UserResponse>(apiRoutes.me, {
    method: "GET",
  }, accessToken);
}

export async function getUserWorkspace(accessToken: string): Promise<UserWorkspaceState> {
  return request<UserWorkspaceState>(apiRoutes.workspace, {
    method: "GET",
  }, accessToken);
}

export async function saveUserWorkspace(payload: UserWorkspaceState, accessToken: string): Promise<UserWorkspaceState> {
  return request<UserWorkspaceState>(apiRoutes.workspace, {
    method: "PUT",
    body: JSON.stringify(payload),
  }, accessToken);
}

export async function convertWithBackend(payload: ConvertRequest, accessToken?: string, signal?: AbortSignal): Promise<ConversionResponse> {
  return request<ConversionResponse>(apiRoutes.convert, {
    method: "POST",
    body: JSON.stringify(payload),
  }, accessToken, signal);
}

export async function runWorkspaceWithBackend(payload: RunWorkspaceRequest): Promise<RunWorkspaceResponse> {
  return request<RunWorkspaceResponse>(apiRoutes.runWorkspace, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function runParserWithBackend(payload: RunParserRequest): Promise<RunParserResponse> {
  return request<RunParserResponse>(apiRoutes.runParser, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getConversionHistory(accessToken: string, skip = 0, limit = 20): Promise<ConversionHistory[]> {
  const query = new URLSearchParams({
    skip: String(skip),
    limit: String(limit),
  });

  return request<ConversionHistory[]>(`${apiRoutes.history}?${query.toString()}`, {
    method: "GET",
  }, accessToken);
}

export async function deleteConversionHistory(accessToken: string, historyId: string): Promise<void> {
  await request<void>(apiRoutes.deleteHistory(historyId), {
    method: "DELETE",
  }, accessToken);
}

export async function deleteConversionSnippet(accessToken: string, collectionId: string, snippetId: string): Promise<void> {
  await request<void>(apiRoutes.deleteConversionSnippet(collectionId, snippetId), {
    method: "DELETE",
  }, accessToken);
}

export async function deleteConversionCollection(accessToken: string, collectionId: string): Promise<void> {
  await request<void>(apiRoutes.deleteConversionCollection(collectionId), {
    method: "DELETE",
  }, accessToken);
}

export async function renameConversionCollection(accessToken: string, collectionId: string, payload: RenameCollectionConversionsRequest): Promise<void> {
  await request<void>(apiRoutes.renameConversionCollection(collectionId), {
    method: "PATCH",
    body: JSON.stringify(payload),
  }, accessToken);
}

export async function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>(apiRoutes.health, {
    method: "GET",
  });
}
