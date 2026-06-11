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
  is_admin: boolean;
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

export interface VerifyOTPRequest {
  email: string;
  otp: string;
}

export interface ResetPasswordRequest {
  email: string;
  otp: string;
  password: string;
}

export interface RunWorkspaceRequest {
  collection_name?: string;
  workspace_name: string;
  request_code: string;
  parser_code: string;
  proxy?: ProxyConfig | null;
  useBackendProxy?: boolean;
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

export interface FeasibilityRequestSpec {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | null;
  timeout_seconds?: number;
  content_marker?: string | null;
}

export interface StartFeasibilityTestRequest {
  collection_name?: string;
  workspace_name: string;
  request: FeasibilityRequestSpec;
  request_code?: string | null;
  user_proxy?: ProxyConfig | null;
  test_user_proxy?: boolean;
  production_like?: boolean;
  polite_delay_enabled?: boolean;
  polite_delay_min_ms?: number;
  polite_delay_max_ms?: number;
  normal_request_retries?: number;
  debugging_mode?: boolean;
}

export interface FeasibilityArtifact {
  filename: string;
  content: string;
  content_type: string;
}

export interface FeasibilityStageMetrics {
  phase: string;
  route: string;
  total_requests: number;
  max_workers: number;
  success_count: number;
  failure_count: number;
  http_success_count: number;
  content_valid_success_count: number;
  retry_recovered_count: number;
  final_failed_count: number;
  success_percentage: number;
  status_distribution: Record<string, number>;
  average_response_time_ms: number;
  min_response_time_ms: number;
  max_response_time_ms: number;
  timeout_count: number;
  status_403_count: number;
  status_429_count: number;
  block_detection_count: number;
  low_confidence_block_count: number;
  medium_confidence_block_count: number;
  high_confidence_block_count: number;
  average_response_size_bytes: number;
  response_size_variance: number;
  total_duration_ms: number;
  requests_per_second: number;
  route_retry_count: number;
  avg_route_attempts_per_request: number;
  requests_passed_after_retry: number;
  requests_failed_after_5_attempts: number;
  route_instability_count: number;
  managed_route_stability: string;
  stability_classification: string;
  validation_reason_distribution: Record<string, number>;
  acceptable: boolean;
  stop_reason?: string | null;
}

export interface FeasibilityRouteResult {
  route: string;
  passed: boolean;
  warmup_passed: boolean;
  highest_stable_workers: number;
  max_tested_workers: number;
  max_tested_total_requests: number;
  managed_route_stability: string;
  stop_reason?: string | null;
  unstable_worker_stage?: number | null;
}

export interface FeasibilitySummary {
  feasibility: string;
  recommended_route: string;
  recommended_workers: string;
  next_tested_stage?: string | null;
  next_stage_failure_reason?: string | null;
  recommendation?: string | null;
  max_tested_total_requests: number;
  block_risk: string;
  data_availability: boolean;
  parser_possible: boolean;
}

export interface FeasibilityTestStatus {
  test_id: string;
  status: "queued" | "running" | "completed" | "cancelled" | "failed";
  workspace_name: string;
  logs: string[];
  current_phase?: string | null;
  current_route?: string | null;
  current_stage?: number | null;
  current_max_workers?: number | null;
  stage_metrics: FeasibilityStageMetrics[];
  route_results: FeasibilityRouteResult[];
  summary?: FeasibilitySummary | null;
  artifacts: FeasibilityArtifact[];
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

export interface IssueFileMetadata {
  filename: string;
  content_type: string;
  size: number;
  index: number;
}

export interface Issue {
  issue_id: string;
  issue_type: string;
  description: string;
  email: string;
  files: IssueFileMetadata[];
  status: "open" | "pending" | "in_progress" | "resolved" | "rejected";
  created_at: string;
  resolved_at?: string | null;
}

export interface CreateIssueResponse {
  success: boolean;
  issue_id: string;
  message: string;
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

export async function verifyOTP(payload: VerifyOTPRequest): Promise<MessageResponse> {
  return request<MessageResponse>(apiRoutes.verifyOTP, {
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

export async function startFeasibilityTest(payload: StartFeasibilityTestRequest): Promise<{ test_id: string; status: string }> {
  return request<{ test_id: string; status: string }>(apiRoutes.feasibilityTests, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function generateFeasibilityCodeArtifacts(payload: StartFeasibilityTestRequest): Promise<{ artifacts: FeasibilityArtifact[] }> {
  return request<{ artifacts: FeasibilityArtifact[] }>(apiRoutes.feasibilityCodeArtifacts, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getFeasibilityTest(testId: string): Promise<FeasibilityTestStatus> {
  return request<FeasibilityTestStatus>(apiRoutes.feasibilityTest(testId), { method: "GET" });
}

export async function cancelFeasibilityTest(testId: string): Promise<FeasibilityTestStatus> {
  return request<FeasibilityTestStatus>(apiRoutes.cancelFeasibilityTest(testId), { method: "POST" });
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

export function getIssueFileUrl(issueId: string, fileIndex: number): string {
  return buildUrl(apiRoutes.issueFile(issueId, fileIndex));
}

async function fetchIssueFile(path: string): Promise<Response> {
  const response = await fetch(buildUrl(path), {
    method: "GET",
  });

  if (response.ok) {
    return response;
  }

  const contentType = response.headers.get("content-type") ?? "";
  let payload: unknown = undefined;

  if (contentType.includes("application/json")) {
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
  } else {
    payload = await response.text();
  }

  throw new ApiError(response.status, extractErrorMessage(payload, `File download failed with status ${response.status}`), payload);
}

export async function downloadIssueFile(issueId: string, fileIndex: number, filename: string): Promise<void> {
  let response: Response;

  try {
    response = await fetchIssueFile(apiRoutes.issueFile(issueId, fileIndex));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      response = await fetchIssueFile(apiRoutes.issueFileFallback(issueId, fileIndex)).catch((fallbackError) => {
        if (fallbackError instanceof ApiError && fallbackError.status === 404) {
          throw new ApiError(
            404,
            "File not found on backend storage.",
            fallbackError.payload,
          );
        }
        throw fallbackError;
      });
    } else {
      throw error;
    }
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename || `issue-file-${fileIndex + 1}`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export async function createIssue(formData: FormData, accessToken: string): Promise<CreateIssueResponse> {
  try {
    return await request<CreateIssueResponse>(apiRoutes.createIssue, {
      method: "POST",
      body: formData,
    }, accessToken);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return request<CreateIssueResponse>(apiRoutes.createIssueFallback, {
        method: "POST",
        body: formData,
      }, accessToken).catch((fallbackError) => {
        if (fallbackError instanceof ApiError && fallbackError.status === 404) {
          throw new ApiError(
            404,
            "Issue endpoint not found. Backend route is missing or not registered.",
            fallbackError.payload,
          );
        }
        throw fallbackError;
      });
    }
    throw error;
  }
}

export async function listIssues(params: { q?: string; status?: string; skip?: number; limit?: number } = {}): Promise<Issue[]> {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.status) query.set("status", params.status);
  query.set("skip", String(params.skip ?? 0));
  query.set("limit", String(params.limit ?? 20));
  try {
    return await request<Issue[]>(`${apiRoutes.listIssues}?${query.toString()}`, { method: "GET" });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return request<Issue[]>(`${apiRoutes.listIssuesFallback}?${query.toString()}`, { method: "GET" });
    }
    throw error;
  }
}

export async function getIssue(issueId: string): Promise<Issue> {
  try {
    return await request<Issue>(apiRoutes.getIssue(issueId), { method: "GET" });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return request<Issue>(apiRoutes.getIssueFallback(issueId), { method: "GET" });
    }
    throw error;
  }
}

export async function listIssuesAdmin(params: { q?: string; status?: string; skip?: number; limit?: number } = {}, accessToken?: string): Promise<Issue[]> {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.status) query.set("status", params.status);
  query.set("skip", String(params.skip ?? 0));
  query.set("limit", String(params.limit ?? 20));
  try {
    return await request<Issue[]>(`${apiRoutes.listIssuesAdmin}?${query.toString()}`, { method: "GET" }, accessToken);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return request<Issue[]>(`${apiRoutes.listIssuesAdminFallback}?${query.toString()}`, { method: "GET" }, accessToken);
    }
    throw error;
  }
}

export async function resolveIssue(issueId: string, accessToken?: string): Promise<Issue> {
  try {
    return await request<Issue>(apiRoutes.resolveIssue(issueId), { method: "PATCH" }, accessToken);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return request<Issue>(apiRoutes.resolveIssueFallback(issueId), { method: "PATCH" }, accessToken);
    }
    throw error;
  }
}

export async function updateIssueStatus(issueId: string, status: string, accessToken?: string): Promise<Issue> {
  try {
    return await request<Issue>(
      apiRoutes.updateIssueStatus(issueId),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      },
      accessToken
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return request<Issue>(
        apiRoutes.updateIssueStatusFallback(issueId),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
        accessToken
      );
    }
    throw error;
  }
}

export async function deleteIssue(issueId: string, accessToken?: string): Promise<void> {
  try {
    await request<void>(apiRoutes.deleteIssue(issueId), { method: "DELETE" }, accessToken);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      await request<void>(apiRoutes.deleteIssueFallback(issueId), { method: "DELETE" }, accessToken);
      return;
    }
    throw error;
  }
}
