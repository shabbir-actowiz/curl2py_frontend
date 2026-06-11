import { Component, type ErrorInfo, type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Check, Copy, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, AlertCircle, Download, X, PanelLeft, FileCode, Save, FolderOpen, LogIn, Plus, Trash2, GripVertical, Upload, LogOut, Pencil, Moon, Sun, Play, Loader2, WrapText, Wrench, UserCircle, Sparkles } from "lucide-react";
import JSZip from "jszip";
import { toast } from "sonner";
import favicon from "/favicon-32x32.png";
import { cn } from "@/lib/utils";
import {
  parseCurl,
  type ParsedCurl,
} from "@/lib/curl-to-python";
import { HighlightedPython } from "@/lib/python-highlight";
import { CodeEditor } from "@/components/CodeEditor";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ApiError,
  createIssue,
  deleteConversionCollection,
  deleteConversionSnippet,
  extractApiErrorMessage,
  generateFeasibilityCodeArtifacts,
  getUserWorkspace,
  renameConversionCollection,
  runParserWithBackend,
  runWorkspaceWithBackend,
  saveUserWorkspace,
  type FeasibilityArtifact,
  type UserWorkspaceState,
} from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";
import { convertCurlLocally, CurlConverterError } from "@/services/curlConverterEngine";
import { buildCurlCraftScript, buildMergedScript, buildParserStubs, enhanceCurlConverterPython, PIPELINE_UTILS_CODE, repairPythonPipelinePlaceholders, scriptUsesPipeline } from "@/services/curlCraftEnhancer";

type Client = "requests" | "httpx";

interface Snippet {
  id: string;
  name: string;
  raw: string;
  collapsed?: boolean;
  useBackendProxy?: boolean;
}

interface SnippetBlock {
  id: string;
  name: string;
  raw: string;
  parsed: ParsedCurl;
}

type TabKind = "request" | "merged" | "parser";
interface OutputTab {
  id: string;
  kind: TabKind;
  filename: string;
  reqIdx?: number;
  code: string;
  hasError?: boolean;
}

type WorkspacePanelTab = "code" | "response" | "parser" | "logs";
type InputPanelTab = "input" | "proxy";
type ThemeMode = "dark" | "light";
type WorkspaceFile = string;
type ParserBuilderMode = "json" | "html";
type ParserPageTab = "source" | "paths" | "parser" | "output" | "jsonSource" | "dbCode";
type ParserOutputView = "json" | "table";
type WorkspaceSaveState = "idle" | "saving" | "saved" | "error" | "session-expired";
type PendingWorkspacePayload = {
  userId: string;
  savedAt: string;
  payload: WorkspacePayload;
};

interface ParserSelection {
  id?: string;
  path: string;
  outputKey: string;
  selectionMode?: "single" | "loop";
  loopPaths?: string[];
  xpath?: string;
  css?: string;
  selectorType?: "xpath" | "css";
  selector?: string;
  extractMode?: "text" | "attr" | "html";
  valueMode?: "text" | "attr" | "html";
  attrName?: string;
  parentSelector?: string;
  parentSelectorType?: "xpath" | "css";
  parentXpath?: string;
  parentCss?: string;
  relativeSelector?: string;
  relativeXpath?: string;
  relativeCss?: string;
}

interface JsonLoopCandidate {
  parentPath: Array<string | number>;
  parentKey: string;
  displayPath: string;
  label: string;
  shortLabel: string;
  sourceIndex: number;
}

interface SelectedLoopCandidate extends JsonLoopCandidate {
  varName: string;
}

interface HtmlElementSelection {
  tagName: string;
  xpath: string;
  cssSelector: string;
  text: string;
  attributes: Record<string, string>;
  parentXpath?: string;
  parentCss?: string;
  relativeXpath?: string;
  relativeCss?: string;
  scriptJson?: ScriptJsonExtraction;
  x: number;
  y: number;
}

interface ScriptJsonSource {
  scriptId: string;
  title: string;
  json: string;
  extractorCode: string;
  standaloneExtractorCode: string;
}

type ScriptJsonExtraction = {
  ok: true;
  value: unknown;
  json: string;
  extractorCode: string;
  standaloneExtractorCode: string;
  scriptId: string;
} | { ok: false; error: string };

type ScriptJsonTextExtraction = {
  ok: true;
  value: unknown;
  raw: string;
  mode: "json" | "assignment";
} | { ok: false; error: string };

interface ParserRunState {
  status: "idle" | "loading" | "success" | "error";
  output: unknown | null;
  error: string | null;
  itemCount: number;
  updatedAt?: number;
}

interface JsonValueSelection {
  keyName: string;
  path: string;
  valueType: string;
  valueText: string;
  valuePreview: string;
  x: number;
  y: number;
}

interface ProxyConfig {
  enabled: boolean;
  url: string;
}

interface WorkspaceArtifact {
  responseJson: string | null;
  responseFileName?: string;
  responseContentType?: string;
  responseExtension?: string;
  responseOutputs?: Record<string, { content: string; contentType: string; extension: string; metaJson?: string }>;
  metaJson: string | null;
  logsTxt: string;
  parserCode: string;
  parserSelections?: ParserSelection[];
  htmlParserSelections?: ParserSelection[];
  htmlContent?: string;
  parserGenerated?: boolean;
  dbSourceJson?: string;
  dbCode?: string;
  feasibilityCodeSignature?: string;
}

interface CollectionState {
  id: string;
  name: string;
  expanded: boolean;
  snippets: Snippet[];
  proxyConfig: ProxyConfig;
  workspaceArtifacts: Record<string, WorkspaceArtifact>;
  backendOutputs: Record<string, string>;
  backendMergedOutput: string | null;
  backendParserOutput: string | null;
}

interface ResponseTab {
  id: string;
  collectionId: string;
  workspaceId: string;
  fileName: string;
  label: string;
}

type WorkspacePayload = UserWorkspaceState;

const SESSION_KEY = "curl2py:session:v2";
const PENDING_WORKSPACE_KEY = "curl2py:workspace:pending:v1";
const THEME_KEY = "curl2py:theme:v1";
const SCRIPT_JSON_STORAGE_PREFIX = "curl2py:script-json:";
const MANUAL_PARSER_WORKSPACE_ID = "__manual_parser_workspace__";

const SAMPLE_SNIPPETS: Snippet[] = [];

const BACKEND_PLACEHOLDER = "# Paste a cURL command to generate Python code locally\n";
const DEFAULT_PROXY_CONFIG: ProxyConfig = { enabled: false, url: "" };
const toolbarButtonClass = "inline-flex h-7 items-center justify-center gap-1.5 rounded-sm border px-2.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45";
const quietToolbarButtonClass = `${toolbarButtonClass} border-border bg-background/40 text-muted-foreground hover:border-border-strong hover:bg-surface-elevated hover:text-foreground`;
const primaryToolbarButtonClass = `${toolbarButtonClass} border-primary/60 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary`;
const topbarButtonClass = "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-sm border border-border bg-background/45 px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border-strong hover:bg-surface-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45";
const topbarPrimaryButtonClass = "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-sm border border-primary/70 bg-primary/15 px-3 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45";
const topbarRunButtonClass = "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-sm border border-primary/80 bg-primary px-3.5 text-[11px] font-semibold text-primary-foreground shadow-sm shadow-primary/10 transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45";
const modernMenuContentClass = "min-w-48 border-border bg-background/95 p-1 text-foreground shadow-xl shadow-black/20 backdrop-blur";
const modernMenuItemClass = "gap-2 rounded-sm px-2 py-1.5 text-[12px] text-muted-foreground focus:bg-surface-elevated focus:text-foreground";
const panelTabClass = "relative border-r border-border px-3 py-2 text-[12px] font-mono transition-colors";
const fileTabClass = "group relative flex cursor-pointer items-center gap-1.5 border-r border-border px-3 py-2 text-[11px] font-mono transition-colors";

class ParserInspectorErrorBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { hasError: boolean; message: string }
> {
  state = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : "The parser inspector failed to render.",
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Parser inspector crashed", error, info);
  }

  componentDidUpdate(prevProps: { resetKey: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, message: "" });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="m-4 rounded-sm border border-destructive/40 bg-destructive/10 px-4 py-3 font-mono text-[12px] text-foreground">
        <div className="font-semibold text-destructive">Parser inspector recovered from an error.</div>
        <div className="mt-1 text-muted-foreground">
          {this.state.message || "Try switching tabs or editing the response source."}
        </div>
      </div>
    );
  }
}

function buildParserStub(workspaceName: string): string {
  return [
    "def parse_response(response):",
    `    # parser stub for ${workspaceName}`,
    "    return response",
    "",
  ].join("\n");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}kb`;
}

function readWorkspaceMeta(metaJson: string | null): { status: number | null; time_ms?: number; time?: number; size: string } | null {
  if (!metaJson) return null;
  try {
    return JSON.parse(metaJson) as { status: number | null; time_ms?: number; time?: number; size: string };
  } catch {
    return null;
  }
}

function sanitizeName(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^_+/, "");
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

function resolveEffectiveNames(snippets: Snippet[]): string[] {
  const used = new Set<string>();
  return snippets.map((s, i) => {
    const base = (s.name || "").trim() || `request_${i + 1}`;
    let n = base;
    let k = 2;
    while (used.has(n)) n = `${base}_${k++}`;
    used.add(n);
    return n;
  });
}

function createDefaultSnippet(name = "request_1"): Snippet {
  return {
    id: newId(),
    name,
    raw: "",
    useBackendProxy: false,
  };
}

function createCollection(id: string, name: string, snippets: Snippet[] = [createDefaultSnippet()], expanded = true): CollectionState {
  return {
    id,
    name,
    expanded,
    snippets,
    proxyConfig: { ...DEFAULT_PROXY_CONFIG },
    workspaceArtifacts: {},
    backendOutputs: {},
    backendMergedOutput: null,
    backendParserOutput: null,
  };
}

function collectParserOutputKeys(value: unknown): string[] {
  if (!value) return [];
  const keys = new Set<string>();
  const addFromObject = (item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    Object.keys(item as Record<string, unknown>).forEach((key) => keys.add(key));
  };
  if (Array.isArray(value)) {
    value.forEach(addFromObject);
  } else {
    addFromObject(value);
  }
  return Array.from(keys).sort();
}

function parseJsonKeys(content: string | undefined): string[] {
  if (!content) return [];
  try {
    return collectParserOutputKeys(JSON.parse(content));
  } catch {
    return [];
  }
}

function normalizeProxyConfig(value: unknown): ProxyConfig {
  if (!value || typeof value !== "object") return { ...DEFAULT_PROXY_CONFIG };
  const proxy = value as Partial<ProxyConfig> & { http?: string; https?: string };
  const legacyUrl = typeof proxy.http === "string" && proxy.http.trim()
    ? proxy.http
    : typeof proxy.https === "string"
      ? proxy.https
      : "";
  return {
    enabled: !!proxy.enabled,
    url: typeof proxy.url === "string" ? proxy.url : legacyUrl,
  };
}

function normalizeSnippet(snippet: Partial<Snippet>, fallbackName = "request_1"): Snippet {
  return {
    id: typeof snippet.id === "string" && snippet.id.trim() ? snippet.id : newId(),
    name: typeof snippet.name === "string" ? sanitizeName(snippet.name) || fallbackName : fallbackName,
    raw: typeof snippet.raw === "string" ? snippet.raw : "",
    collapsed: !!snippet.collapsed,
    useBackendProxy: !!snippet.useBackendProxy,
  };
}

function withCollectionDefaults(collection: CollectionState): CollectionState {
  const normalizedId = typeof collection.id === "string" && collection.id.trim() ? collection.id : newId();
  return {
    ...collection,
    id: normalizedId,
    name: typeof collection.name === "string" && collection.name.trim() ? collection.name : "collection",
    snippets: (collection.snippets || []).map((snippet, index) => normalizeSnippet(snippet, `request_${index + 1}`)),
    proxyConfig: normalizeProxyConfig(collection.proxyConfig),
    workspaceArtifacts: collection.workspaceArtifacts || {},
    backendOutputs: collection.backendOutputs || {},
    backendMergedOutput: collection.backendMergedOutput ?? null,
    backendParserOutput: collection.backendParserOutput ?? null,
  };
}

function normalizeCollections(collections: Record<string, CollectionState>): Record<string, CollectionState> {
  return Object.fromEntries(
    Object.values(collections).map((collection) => {
      const normalized = withCollectionDefaults(collection);
      return [normalized.id, normalized];
    })
  ) as Record<string, CollectionState>;
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function generatedCodeMatchesRequestName(code: string, requestName: string): boolean {
  const escaped = escapeRegExp(requestName);
  const hasFunctionName = new RegExp(`def\\s+${escaped}\\s*\\(`).test(code);
  const hasExecutionName = new RegExp(`request_name\\s*=\\s*["']${escaped}["']`).test(code);
  return hasFunctionName && hasExecutionName;
}

function scriptJsonStorageKey(sourceKey: string) {
  return `${SCRIPT_JSON_STORAGE_PREFIX}${sourceKey}`;
}

function getFriendlyErrorMessage(error: unknown): string {
  const rawMessage = extractApiErrorMessage(error);
  const message = rawMessage.trim() || "Conversion failed. Please try again.";
  const normalized = message.toLowerCase();
  if (normalized.includes("e11000") || normalized.includes("duplicate key")) {
    return "Could not save conversion. Please refresh and try again.";
  }
  if (normalized.includes("failed to fetch") || normalized.includes("networkerror") || normalized.includes("network error")) {
    return "Backend connection failed.";
  }
  if (normalized.includes("missing collection_id") || normalized.includes("missing snippet_id")) {
    return "Missing collection or snippet identity.";
  }
  if (normalized.startsWith("body.") || normalized.includes("validation")) {
    return message;
  }
  if (normalized.startsWith("internal error")) {
    return "Conversion failed. Please try again.";
  }
  return message;
}

function sanitizeCollectionsForStorage(collections: Record<string, CollectionState>): Record<string, CollectionState> {
  return Object.fromEntries(
    Object.values(collections).map((collection) => {
      const normalized = withCollectionDefaults(collection);
      return [
        normalized.id,
        {
          ...normalized,
          workspaceArtifacts: Object.fromEntries(
            Object.entries(collection.workspaceArtifacts || {}).map(([workspaceId, artifact]) => [
              workspaceId,
              {
                ...artifact,
                responseJson: null,
                logsTxt: "",
              },
            ])
          ),
        },
      ];
    })
  ) as Record<string, CollectionState>;
}

function defaultResponseFileName(workspaceName: string): string {
  return `${workspaceName}_response.json`;
}

export function preserveValidatedJsonSource(source: string): string {
  const trimmed = source.trim();
  JSON.parse(trimmed);
  return trimmed;
}

function isResponseFile(file: string): boolean {
  return /_response\.(json|txt|html)$/i.test(file);
}

export default function Index() {
  const [collections, setCollections] = useState<Record<string, CollectionState>>(() => ({
    tmp: createCollection("tmp", "tmp", SAMPLE_SNIPPETS, true),
  }));
  const [activeCollectionId, setActiveCollectionId] = useState<string>("tmp");
  const [activeTabId, setActiveTabId] = useState<string>("");
  const [hoveredSnippetId, setHoveredSnippetId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [client, setClient] = useState<Client>("requests");
  const [isAsync, setIsAsync] = useState(false);
  const [mergeMode, setMergeMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [closedTabIds, setClosedTabIds] = useState<Set<string>>(new Set());
  const [statusMsg, setStatusMsg] = useState<string>("Ready");
  const [statusKind, setStatusKind] = useState<"info" | "success" | "error">("info");
  const [savedSession, setSavedSession] = useState<boolean>(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [isSyncingBackend, setIsSyncingBackend] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isRunningParser, setIsRunningParser] = useState(false);
  const [raiseIssueOpen, setRaiseIssueOpen] = useState(false);
  const [htmlParserOpen, setHtmlParserOpen] = useState(false);
  const [htmlScriptJsonSources, setHtmlScriptJsonSources] = useState<ScriptJsonSource[]>([]);
  const [selectedHtmlScriptJsonId, setSelectedHtmlScriptJsonId] = useState("");
  const [issueType, setIssueType] = useState("Workspace");
  const [issueDescription, setIssueDescription] = useState("");
  const [issueFiles, setIssueFiles] = useState<File[]>([]);
  const [isSubmittingIssue, setIsSubmittingIssue] = useState(false);
  const [submittedIssueId, setSubmittedIssueId] = useState("");
  const [pendingParserReplacePath, setPendingParserReplacePath] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>("");
  const [activeWorkspaceFile, setActiveWorkspaceFile] = useState<WorkspaceFile>("request.py");
  const [dirtyCodeTabs, setDirtyCodeTabs] = useState<Record<string, boolean>>({});
  const [codeWordWrap, setCodeWordWrap] = useState(false);
  const [activeInputTab, setActiveInputTab] = useState<InputPanelTab>("input");
  const [activePanelTab, setActivePanelTab] = useState<WorkspacePanelTab>("code");
  const [parserBuilderMode, setParserBuilderMode] = useState<ParserBuilderMode>("json");
  const [parserPageTab, setParserPageTab] = useState<ParserPageTab>("source");
  const [openLoopDropdownIndex, setOpenLoopDropdownIndex] = useState<number | null>(null);
  const [quickAddMode, setQuickAddMode] = useState(false);
  const [selectedParserPath, setSelectedParserPath] = useState<string | null>(null);
  const [selectedParserValue, setSelectedParserValue] = useState<unknown>(null);
  const [selectedParserOutputKey, setSelectedParserOutputKey] = useState("");
  const [parserSelectionsByRequest, setParserSelectionsByRequest] = useState<Record<string, ParserSelection[]>>({});
  const [htmlParserSelectionsByRequest, setHtmlParserSelectionsByRequest] = useState<Record<string, ParserSelection[]>>({});
  const [manualParserJsonByWorkspace, setManualParserJsonByWorkspace] = useState<Record<string, string>>({});
  const [scriptJsonParserByWorkspace, setScriptJsonParserByWorkspace] = useState<Record<string, boolean>>({});
  const [manualParserHtmlByWorkspace, setManualParserHtmlByWorkspace] = useState<Record<string, string>>({});
  const [isEditingParserJson, setIsEditingParserJson] = useState(false);
  const [isEditingParserHtml, setIsEditingParserHtml] = useState(false);
  const [parserJsonDraft, setParserJsonDraft] = useState("");
  const [parserHtmlDraft, setParserHtmlDraft] = useState("");
  const [parserRunsByRequest, setParserRunsByRequest] = useState<Record<string, ParserRunState>>({});
  const [parserOutputView, setParserOutputView] = useState<ParserOutputView>("json");
  const [scriptJsonSourcesByRequest, setScriptJsonSourcesByRequest] = useState<Record<string, ScriptJsonSource>>({});
  const [parserCodeFile, setParserCodeFile] = useState<"parser" | "extractor">("parser");
  const [dbJsonByRequest, setDbJsonByRequest] = useState<Record<string, string>>({});
  const [dbJsonDraft, setDbJsonDraft] = useState("");
  const [isEditingDbJson, setIsEditingDbJson] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      return window.localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Set<string>>(new Set());
  const [openResponseTabs, setOpenResponseTabs] = useState<ResponseTab[]>([]);
  const [activeResponseTabId, setActiveResponseTabId] = useState<string | null>(null);
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [editingCollectionName, setEditingCollectionName] = useState("");
  const [dividerPos, setDividerPos] = useState(50);
  const [isDraggingDivider, setIsDraggingDivider] = useState(false);
  const [hasLoadedRemoteWorkspace, setHasLoadedRemoteWorkspace] = useState(false);
  const [workspaceSaveState, setWorkspaceSaveState] = useState<WorkspaceSaveState>("idle");
  const [lastWorkspaceSavedAt, setLastWorkspaceSavedAt] = useState<Date | null>(null);

  const { user, accessToken, refreshAccessToken, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const parserRouteParams = useParams<{ collectionId?: string; snippetId?: string; scriptId?: string }>();
  const isParserRoute = location.pathname.startsWith("/parser");

  const outputRef = useRef<HTMLDivElement>(null);
  const snippetRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const focusNameOnMountId = useRef<string | null>(null);
  const nameInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const mainRef = useRef<HTMLDivElement>(null);
  const inFlightSyncKeyRef = useRef<string | null>(null);
  const lastSuccessfulSyncKeyRef = useRef<string | null>(null);
  const lastSyncedSnippetHashesRef = useRef<Record<string, string>>({});
  const accessTokenRef = useRef<string | null>(accessToken);
  const saveInFlightRef = useRef(false);
  const pendingWorkspaceVersionRef = useRef(0);
  const queuedWorkspaceSaveRef = useRef<{ payload: WorkspacePayload; manual: boolean; version: number } | null>(null);

  const activeCollection = collections[activeCollectionId] ?? Object.values(collections)[0] ?? createCollection("tmp", "tmp", [], true);
  const snippets = activeCollection.snippets;
  const proxyConfig = activeCollection.proxyConfig ?? DEFAULT_PROXY_CONFIG;
  const backendOutputs = activeCollection.backendOutputs;
  const backendMergedOutput = activeCollection.backendMergedOutput;
  const backendParserOutput = activeCollection.backendParserOutput;
  const workspaceArtifacts = activeCollection.workspaceArtifacts;

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Keep the in-memory theme if storage is unavailable.
    }
  }, [theme]);

  const updateActiveCollection = (patcher: (collection: CollectionState) => CollectionState) => {
    setCollections((prev) => {
      const current = prev[activeCollectionId] ?? Object.values(prev)[0];
      if (!current) return prev;
      return {
        ...prev,
        [current.id]: patcher(current),
      };
    });
  };

  const setSnippets = (updater: Snippet[] | ((prev: Snippet[]) => Snippet[])) => {
    updateActiveCollection((collection) => {
      const nextSnippets = typeof updater === "function"
        ? (updater as (prev: Snippet[]) => Snippet[])(collection.snippets)
        : updater;
      return { ...collection, snippets: nextSnippets };
    });
  };

  const setBackendOutputs = (updater: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => {
    updateActiveCollection((collection) => {
      const nextOutputs = typeof updater === "function"
        ? (updater as (prev: Record<string, string>) => Record<string, string>)(collection.backendOutputs)
        : updater;
      return { ...collection, backendOutputs: nextOutputs };
    });
  };

  const setBackendMergedOutput = (value: string | null) => {
    updateActiveCollection((collection) => ({ ...collection, backendMergedOutput: value }));
  };

  const setBackendParserOutput = (value: string | null) => {
    updateActiveCollection((collection) => ({ ...collection, backendParserOutput: value }));
  };

  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  const buildWorkspacePayload = useCallback((): WorkspacePayload => ({
    collections: sanitizeCollectionsForStorage(collections),
    activeCollectionId,
    theme,
    openResponseTabs: openResponseTabs as unknown as Record<string, unknown>[],
    activeResponseTabId,
  }), [activeCollectionId, activeResponseTabId, collections, openResponseTabs, theme]);

  const persistPendingWorkspace = useCallback((payload: WorkspacePayload) => {
    if (!user?.id) return 0;
    const version = pendingWorkspaceVersionRef.current + 1;
    pendingWorkspaceVersionRef.current = version;
    try {
      const pending: PendingWorkspacePayload = {
        userId: user.id,
        savedAt: new Date().toISOString(),
        payload,
      };
      window.localStorage.setItem(PENDING_WORKSPACE_KEY, JSON.stringify(pending));
    } catch {
      // Local persistence is best-effort; in-memory state still carries the edit.
    }
    return version;
  }, [user?.id]);

  const clearPendingWorkspace = useCallback((version: number) => {
    if (version !== pendingWorkspaceVersionRef.current) return;
    try {
      window.localStorage.removeItem(PENDING_WORKSPACE_KEY);
    } catch {
      // Ignore localStorage cleanup errors.
    }
  }, []);

  const saveWorkspacePayload = useCallback(async (payload: WorkspacePayload, options: { manual?: boolean } = {}) => {
    if (!user) return;
    const manual = !!options.manual;
    const version = persistPendingWorkspace(payload);
    if (!version) return;

    if (saveInFlightRef.current) {
      queuedWorkspaceSaveRef.current = { payload, manual, version };
      if (manual) {
        setWorkspaceSaveState("saving");
        setStatusKind("info");
        setStatusMsg("Saving...");
      }
      return;
    }

    saveInFlightRef.current = true;
    queuedWorkspaceSaveRef.current = null;
    let current: { payload: WorkspacePayload; manual: boolean; version: number } | null = { payload, manual, version };

    while (current) {
      setWorkspaceSaveState("saving");
      if (current.manual) {
        setStatusKind("info");
        setStatusMsg("Saving...");
      }

      let didSave = false;
      try {
        const token = accessTokenRef.current;
        if (!token) throw new ApiError(401, "Session expired", null);
        await saveUserWorkspace(current.payload, token);
        didSave = true;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          const refreshedToken = await refreshAccessToken();
          if (!refreshedToken) {
            setWorkspaceSaveState("session-expired");
            setStatusKind("error");
            setStatusMsg("Session expired, please login again");
            break;
          }
          accessTokenRef.current = refreshedToken;
          try {
            await saveUserWorkspace(current.payload, refreshedToken);
            didSave = true;
          } catch (retryError) {
            if (retryError instanceof ApiError && retryError.status === 401) {
              setWorkspaceSaveState("session-expired");
              setStatusKind("error");
              setStatusMsg("Session expired, please login again");
            } else {
              setWorkspaceSaveState("error");
              setStatusKind("error");
              setStatusMsg("Could not save workspace");
              if (import.meta.env.DEV) console.debug("Workspace save retry failed", retryError);
            }
            break;
          }
        } else {
          setWorkspaceSaveState("error");
          setStatusKind("error");
          setStatusMsg("Could not save workspace");
          if (import.meta.env.DEV) console.debug("Workspace save failed", error);
          break;
        }
      }

      if (didSave) {
        clearPendingWorkspace(current.version);
        if (!queuedWorkspaceSaveRef.current) {
          setWorkspaceSaveState("saved");
          setLastWorkspaceSavedAt(new Date());
          if (current.manual) {
            setStatusKind("success");
            setStatusMsg("Saved");
          }
        }
      }

      current = queuedWorkspaceSaveRef.current;
      queuedWorkspaceSaveRef.current = null;
    }

    saveInFlightRef.current = false;
  }, [clearPendingWorkspace, persistPendingWorkspace, refreshAccessToken, user]);

  const handleManualWorkspaceSave = useCallback(() => {
    void saveWorkspacePayload(buildWorkspacePayload(), { manual: true });
  }, [buildWorkspacePayload, saveWorkspacePayload]);

  const setWorkspaceArtifacts = (updater: Record<string, WorkspaceArtifact> | ((prev: Record<string, WorkspaceArtifact>) => Record<string, WorkspaceArtifact>)) => {
    updateActiveCollection((collection) => {
      const nextArtifacts = typeof updater === "function"
        ? (updater as (prev: Record<string, WorkspaceArtifact>) => Record<string, WorkspaceArtifact>)(collection.workspaceArtifacts)
        : updater;
      return { ...collection, workspaceArtifacts: nextArtifacts };
    });
  };

  const updateWorkspaceArtifact = (workspaceId: string, patcher: (artifact: WorkspaceArtifact) => WorkspaceArtifact) => {
    setWorkspaceArtifacts((prev) => {
      const current = prev[workspaceId] ?? {
        responseJson: null,
        metaJson: null,
        logsTxt: "",
        parserCode: buildParserStub(activeWorkspaceDisplayName),
      };
      return {
        ...prev,
        [workspaceId]: patcher(current),
      };
    });
  };

  const setProxyConfig = (updater: ProxyConfig | ((prev: ProxyConfig) => ProxyConfig)) => {
    updateActiveCollection((collection) => {
      const currentProxy = normalizeProxyConfig(collection.proxyConfig);
      const nextProxy = typeof updater === "function"
        ? (updater as (prev: ProxyConfig) => ProxyConfig)(currentProxy)
        : updater;
      return { ...collection, proxyConfig: normalizeProxyConfig(nextProxy) };
    });
  };

  const validateProxyConfig = (silent = false) => {
    if (!proxyConfig.enabled) return true;
    if (proxyConfig.url.trim()) return true;
    const message = "Proxy is enabled but no proxy URL provided";
    if (!silent) {
      setStatusKind("error");
      setStatusMsg(message);
      toast.error(message);
    }
    return false;
  };

  // Build parsed blocks per snippet
  const blocks: SnippetBlock[] = useMemo(
    () =>
      snippets.map((s) => ({
        id: s.id,
        name: s.name,
        raw: s.raw,
        parsed: parseCurl(s.raw.trim() ? s.raw : "curl"),
      })),
    [snippets]
  );

  const errorCount = blocks.filter((b) => !b.raw.trim()).length;
  const validBlocks = blocks.filter((b) => b.raw.trim());

  // Detect duplicate names
  const nameCounts = useMemo(() => {
    const map: Record<string, number> = {};
    snippets.forEach((s) => {
      const k = (s.name || "").trim();
      if (!k) return;
      map[k] = (map[k] || 0) + 1;
    });
    return map;
  }, [snippets]);

  const isDuplicate = (name: string) => (nameCounts[name] || 0) > 1;

  // Resolve effective names (fallback request_N, dedupe)
  const effectiveNames = useMemo(() => resolveEffectiveNames(snippets), [snippets]);

  const outputs = useMemo(
    () => blocks.map((b) => backendOutputs[b.id] ?? (b.raw.trim() ? BACKEND_PLACEHOLDER : "# Empty snippet - paste a curl command\n")),
    [blocks, backendOutputs]
  );

  const allTabs: OutputTab[] = useMemo(() => {
    const tabs: OutputTab[] = blocks.map((b, i) => ({
      id: `req-${b.id}`,
      kind: "request",
      filename: `${effectiveNames[i]}.py`,
      reqIdx: i,
      code: outputs[i] || "",
      hasError: !b.raw.trim(),
    }));

    if (mergeMode && validBlocks.length > 0) {
      tabs.push({
        id: "merged",
        kind: "merged",
        filename: "main.py",
        code: backendMergedOutput ?? BACKEND_PLACEHOLDER,
      });
    }

    return tabs;
  }, [blocks, outputs, mergeMode, validBlocks, backendMergedOutput]);

  const visibleTabs = useMemo(
    () => allTabs.filter((t) => !closedTabIds.has(t.id)),
    [allTabs, closedTabIds]
  );

  const activeTab = visibleTabs.find((t) => t.id === activeTabId) || visibleTabs[0];
  const activeReqIdx = activeTab?.reqIdx ?? null;
  const activeWorkspaceIdx = snippets.findIndex((snippet) => snippet.id === activeWorkspaceId);
  const activeWorkspaceName = activeWorkspaceIdx >= 0 ? effectiveNames[activeWorkspaceIdx] : "";
  const activeWorkspaceDisplayName = activeWorkspaceName || "request";
  const activeWorkspaceArtifact = activeWorkspaceId ? workspaceArtifacts[activeWorkspaceId] : undefined;
  const activeRequestCode = activeTab?.code ?? "";
  const activeWorkspaceRequestCode = activeWorkspaceId
    ? allTabs.find((tab) => tab.id === `req-${activeWorkspaceId}`)?.code ?? ""
    : "";
  const activeCodeFilename = activeTab?.filename || "-";
  const activeCodeContent = activeRequestCode;
  const isActiveCodeDirty = !!(activeTab && dirtyCodeTabs[activeTab.id]);
  const panelCodeFilename = activeWorkspaceFile === "db.py"
    ? "db.py"
    : activeWorkspaceFile === "parser.py"
    ? "parser.py"
    : activeWorkspaceFile === "pipeline_utils.py"
    ? "pipeline_utils.py"
    : activeTab?.kind === "merged" || activeTab?.kind === "parser"
    ? activeTab.filename
    : activeCodeFilename;
  const panelCodeContent = activeWorkspaceFile === "db.py"
    ? activeWorkspaceArtifact?.dbCode ?? ""
    : activeWorkspaceFile === "parser.py"
    ? activeWorkspaceArtifact?.parserCode ?? buildParserStub(activeWorkspaceDisplayName)
    : activeWorkspaceFile === "pipeline_utils.py"
    ? PIPELINE_UTILS_CODE
    : activeTab?.kind === "merged" || activeTab?.kind === "parser"
    ? activeTab.code
    : activeCodeContent;
  const activeMetaJson = activeWorkspaceArtifact?.metaJson;
  const activeLogsTxt = activeWorkspaceArtifact?.logsTxt ?? "";
  const activeFeasibilityRequest = activeWorkspaceIdx >= 0 ? blocks[activeWorkspaceIdx]?.parsed ?? null : null;
  const activeRequestMethod = activeFeasibilityRequest?.method?.toUpperCase() || "REQ";
  const activeRequestDomain = activeFeasibilityRequest?.domain || "-";
  const parserStatusLabel = activeWorkspaceArtifact?.parserCode && activeWorkspaceArtifact.parserCode !== buildParserStub(activeWorkspaceDisplayName)
    ? "Parser"
    : "None";
  const saveStatusLabel = workspaceSaveState === "saving"
    ? "Saving..."
    : workspaceSaveState === "session-expired"
      ? "Session expired"
      : workspaceSaveState === "error"
        ? "Could not save"
        : workspaceSaveState === "saved"
          ? lastWorkspaceSavedAt
            ? `Last saved ${formatRelativeSeconds(lastWorkspaceSavedAt)}`
            : "Saved"
          : user
            ? "Not saved"
            : "Login to save";
  const visibleResponseTabs = useMemo(
    () => openResponseTabs.filter((tab) => tab.collectionId === activeCollection.id),
    [openResponseTabs, activeCollection.id]
  );
  const activeResponseTab = visibleResponseTabs.find((tab) => tab.id === activeResponseTabId) || visibleResponseTabs[0] || null;
  const activeResponseWorkspaceIdx = activeResponseTab
    ? snippets.findIndex((snippet) => snippet.id === activeResponseTab.workspaceId)
    : activeWorkspaceIdx;
  const activeResponseWorkspaceName = activeResponseWorkspaceIdx >= 0
    ? effectiveNames[activeResponseWorkspaceIdx]
    : activeWorkspaceName;
  const activeResponseArtifact = activeResponseTab
    ? workspaceArtifacts[activeResponseTab.workspaceId]
    : activeWorkspaceArtifact;
  const activeResponseOutput = activeResponseTab ? activeResponseArtifact?.responseOutputs?.[activeResponseTab.fileName] : undefined;
  const activeResponseJson = activeResponseOutput?.content ?? activeResponseArtifact?.responseJson;
  const activeResponseContentType = activeResponseOutput?.contentType ?? activeResponseArtifact?.responseContentType;
  const activeResponseMode = useMemo(
    () => activeResponseJson ? detectResponseMode(activeResponseJson) : null,
    [activeResponseJson]
  );
  const activeResponseIsJson = activeResponseMode?.kind === "json";
  const activeResponseIsHtml = isHtmlResponse(activeResponseJson ?? "", activeResponseContentType);
  const activeResponseMeta = readWorkspaceMeta(activeResponseOutput?.metaJson ?? activeResponseArtifact?.metaJson ?? null);
  const parserCollection = parserRouteParams.collectionId
    ? collections[parserRouteParams.collectionId] ?? activeCollection
    : activeCollection;
  const parserSnippets = parserCollection.snippets;
  const parserNames = parserCollection.id === activeCollection.id ? effectiveNames : resolveEffectiveNames(parserSnippets);
  const parserWorkspaceId = parserRouteParams.snippetId || activeResponseTab?.workspaceId || activeWorkspaceId || MANUAL_PARSER_WORKSPACE_ID;
  const parserWorkspaceIndex = parserSnippets.findIndex((snippet) => snippet.id === parserWorkspaceId);
  const parserWorkspaceName = parserWorkspaceIndex >= 0
    ? parserNames[parserWorkspaceIndex]
    : activeResponseWorkspaceName || activeWorkspaceDisplayName || "manual_json";
  const parserArtifact = parserWorkspaceId ? parserCollection.workspaceArtifacts[parserWorkspaceId] : undefined;
  const isScriptJsonRoute = !!parserRouteParams.scriptId;
  const scriptJsonSourceKey = isScriptJsonRoute && parserWorkspaceId && parserRouteParams.scriptId
    ? `${parserCollection.id}:${parserWorkspaceId}:script-json:${parserRouteParams.scriptId}`
    : "";
  const activeScriptJsonSource = scriptJsonSourceKey ? scriptJsonSourcesByRequest[scriptJsonSourceKey] : undefined;
  const [scriptJsonLoadAttemptedByKey, setScriptJsonLoadAttemptedByKey] = useState<Record<string, boolean>>({});
  const scriptJsonLoadAttempted = !!(scriptJsonSourceKey && scriptJsonLoadAttemptedByKey[scriptJsonSourceKey]);
  const parserResponseJson = isScriptJsonRoute
    ? activeScriptJsonSource?.json ?? null
    : (parserWorkspaceId ? manualParserJsonByWorkspace[parserWorkspaceId] : undefined) ?? parserArtifact?.responseJson ?? null;
  const parserResponseHtml = (parserWorkspaceId ? manualParserHtmlByWorkspace[parserWorkspaceId] : undefined) ?? parserArtifact?.htmlContent ?? normalizeHtmlSource(parserArtifact?.responseJson ?? "");
  const parserResponseMode = useMemo(
    () => parserResponseJson ? detectResponseMode(parserResponseJson) : null,
    [parserResponseJson]
  );
  const parserResponseIsJson = parserResponseMode?.kind === "json";
  const parserResponseIsHtml = isHtmlResponse(parserResponseHtml, parserArtifact?.responseContentType);
  const detectedParserMode: ParserBuilderMode = isScriptJsonRoute ? "json" : parserResponseIsHtml && !parserResponseIsJson ? "html" : "json";
  const parserUsesScriptJson = false;
  const activeParserRequestKey = isScriptJsonRoute
    ? scriptJsonSourceKey
    : parserWorkspaceId ? `${parserCollection.id}:${parserWorkspaceId}` : "";
  const parserSelections = activeParserRequestKey
    ? parserSelectionsByRequest[activeParserRequestKey] ?? (isScriptJsonRoute ? [] : parserArtifact?.parserSelections ?? [])
    : [];
  const existingParserSelections = useMemo(
    () => filterSelectionsByJsonSource(parserSelections, parserResponseJson),
    [parserSelections, parserResponseJson]
  );
  const htmlParserSelections = activeParserRequestKey
    ? htmlParserSelectionsByRequest[activeParserRequestKey] ?? (isScriptJsonRoute ? [] : parserArtifact?.htmlParserSelections ?? [])
    : [];
  const addedParserPaths = useMemo(
    () => new Set(parserSelections.map((selection) => selection.path)),
    [parserSelections]
  );
  const addedHtmlPaths = useMemo(
    () => new Set(htmlParserSelections.map((selection) => selection.selector || selection.path)),
    [htmlParserSelections]
  );
  const activeParserRun = activeParserRequestKey ? parserRunsByRequest[activeParserRequestKey] : undefined;
  const parserOutputContent = activeParserRun?.output !== undefined && activeParserRun?.output !== null
    ? JSON.stringify(activeParserRun.output, null, 2)
    : "";
  const parserInsertGroups = useMemo(() => {
    return snippets.map((snippet, index) => {
      const requestName = effectiveNames[index] ?? snippet.name ?? `request_${index + 1}`;
      const artifact = workspaceArtifacts[snippet.id];
      const run = parserRunsByRequest[`${activeCollection.id}:${snippet.id}`];
      const keys = new Set<string>();
      (artifact?.parserSelections ?? []).forEach((selection) => keys.add(sanitizeOutputKey(selection.outputKey)));
      (artifact?.htmlParserSelections ?? []).forEach((selection) => keys.add(sanitizeOutputKey(selection.outputKey)));
      collectParserOutputKeys(run?.output).forEach((key) => keys.add(key));
      Object.entries(artifact?.responseOutputs ?? {})
        .filter(([file]) => file.endsWith("_parser_output.json"))
        .forEach(([, output]) => parseJsonKeys(output.content).forEach((key) => keys.add(key)));
      return { requestName, keys: Array.from(keys).filter(Boolean).sort() };
    }).filter((group) => group.keys.length > 0);
  }, [snippets, effectiveNames, workspaceArtifacts, parserRunsByRequest, activeCollection.id]);
  const currentJsonLoop = useMemo(() => getPrimaryJsonLoopContext(existingParserSelections), [existingParserSelections]);
  const currentHtmlLoop = useMemo(() => getPrimaryHtmlLoopContext(htmlParserSelections), [htmlParserSelections]);
  const parserLoopCount = parserBuilderMode === "html"
    ? getHtmlLoopContexts(htmlParserSelections).length
    : getJsonLoopContexts(existingParserSelections).length;
  const parserCode = parserBuilderMode === "html"
    ? safeGenerateHtmlParserCode(parserWorkspaceName, htmlParserSelections)
    : existingParserSelections.length > 0
      ? generateParserCode(parserWorkspaceName, existingParserSelections, parserUsesScriptJson ? "script_json" : "response_json")
      : parserArtifact?.parserCode ?? buildParserStub(parserWorkspaceName);
  const hasSavedDbJsonSource = !!activeParserRequestKey && (
    Object.prototype.hasOwnProperty.call(dbJsonByRequest, activeParserRequestKey) ||
    parserArtifact?.dbSourceJson !== undefined
  );
  const savedDbJsonSource = activeParserRequestKey
    ? dbJsonByRequest[activeParserRequestKey] ?? parserArtifact?.dbSourceJson ?? ""
    : "";
  const dbJsonSourceContent = hasSavedDbJsonSource ? savedDbJsonSource : parserOutputContent || "";
  const visibleDbJsonSource = isEditingDbJson ? dbJsonDraft : dbJsonSourceContent;
  const dbGeneration = useMemo(
    () => generateMysqlDbCode(dbJsonSourceContent, parserWorkspaceName),
    [dbJsonSourceContent, parserWorkspaceName]
  );
  const dbCode = dbGeneration.code;
  const dbSourceJson = dbJsonSourceContent;

  const handleParserPathSelect = useCallback((path: string | null, value?: unknown) => {
    setSelectedParserPath(path);
    setSelectedParserValue(value ?? null);
    setSelectedParserOutputKey(path ? getOutputKeyFromPath(path) : "");
  }, []);

  useEffect(() => {
    handleParserPathSelect(null);
  }, [handleParserPathSelect, parserResponseJson, parserWorkspaceId]);

  useEffect(() => {
    if (import.meta.env.DEV) console.debug("selectedPath", selectedParserPath);
  }, [selectedParserPath]);

  useEffect(() => {
    if (import.meta.env.DEV) console.debug("parserSelections", parserSelections);
  }, [parserSelections]);

  useEffect(() => {
    if (isScriptJsonRoute) return;
    if (!activeParserRequestKey || parserSelectionsByRequest[activeParserRequestKey] || !parserArtifact?.parserSelections?.length) return;
    setParserSelectionsByRequest((prev) => ({
      ...prev,
      [activeParserRequestKey]: parserArtifact.parserSelections ?? [],
    }));
  }, [activeParserRequestKey, isScriptJsonRoute, parserArtifact?.parserSelections, parserSelectionsByRequest]);

  useEffect(() => {
    if (isScriptJsonRoute) return;
    if (!activeParserRequestKey || htmlParserSelectionsByRequest[activeParserRequestKey] || !parserArtifact?.htmlParserSelections?.length) return;
    setHtmlParserSelectionsByRequest((prev) => ({
      ...prev,
      [activeParserRequestKey]: parserArtifact.htmlParserSelections ?? [],
    }));
  }, [activeParserRequestKey, htmlParserSelectionsByRequest, isScriptJsonRoute, parserArtifact?.htmlParserSelections]);

  useEffect(() => {
    setParserJsonDraft(parserResponseJson ?? "");
    setIsEditingParserJson(!parserResponseJson && isParserRoute);
  }, [isParserRoute, parserResponseJson, parserWorkspaceId]);

  useEffect(() => {
    setParserHtmlDraft(parserResponseHtml ?? "");
    setIsEditingParserHtml(!parserResponseHtml && isParserRoute);
  }, [isParserRoute, parserResponseHtml, parserWorkspaceId]);

  useEffect(() => {
    if (!isParserRoute || isEditingDbJson) return;
    setDbJsonDraft(dbJsonSourceContent);
  }, [dbJsonSourceContent, isEditingDbJson, isParserRoute, parserWorkspaceId]);

  useEffect(() => {
    if (!isScriptJsonRoute || !scriptJsonSourceKey || activeScriptJsonSource) return;
    try {
      const storageKey = scriptJsonStorageKey(scriptJsonSourceKey);
      const stored = window.sessionStorage.getItem(storageKey) ?? window.localStorage.getItem(storageKey);
      if (!stored) return;
      const source = JSON.parse(stored) as ScriptJsonSource;
      if (!source?.scriptId || typeof source.json !== "string") return;
      setScriptJsonSourcesByRequest((prev) => ({ ...prev, [scriptJsonSourceKey]: source }));
      setParserSelectionsByRequest((prev) => ({ ...prev, [scriptJsonSourceKey]: prev[scriptJsonSourceKey] ?? [] }));
    } catch {
      toast.error("Could not load script JSON source");
    } finally {
      setScriptJsonLoadAttemptedByKey((prev) => ({ ...prev, [scriptJsonSourceKey]: true }));
    }
  }, [activeScriptJsonSource, isScriptJsonRoute, scriptJsonSourceKey]);

  useEffect(() => {
    if (!isParserRoute) return;
    const nextMode = (location.state as { parserMode?: ParserBuilderMode } | null)?.parserMode ?? detectedParserMode;
    setParserBuilderMode(nextMode);
    setParserPageTab((current) => {
      return current === "paths" || current === "parser" || current === "output" || current === "jsonSource" || current === "dbCode" ? current : "source";
    });
  }, [detectedParserMode, isParserRoute, location.state, parserWorkspaceId]);

  useEffect(() => {
    if (!isParserRoute) return;
    if (parserRouteParams.collectionId && collections[parserRouteParams.collectionId]) {
      setActiveCollectionId(parserRouteParams.collectionId);
    }
    if (parserWorkspaceId) {
      setActiveWorkspaceId(parserWorkspaceId);
      setActiveWorkspaceFile("parser.py");
    }
  }, [isParserRoute, parserRouteParams.collectionId, parserWorkspaceId, collections]);
  const snippetSyncHashes = useMemo(() => Object.fromEntries(
    snippets.map((snippet, index) => [
      snippet.id,
      stableHash({
        collectionId: activeCollection.id,
        snippetId: snippet.id,
        name: effectiveNames[index],
        raw: snippet.raw,
        useBackendProxy: !!snippet.useBackendProxy,
        client,
        isAsync,
        mergeMode,
        proxyConfig,
      }),
    ])
  ) as Record<string, string>, [activeCollection.id, snippets, effectiveNames, client, isAsync, mergeMode, proxyConfig]);
  const syncKey = useMemo(() => JSON.stringify({
    collectionId: activeCollection.id,
    snippetSyncHashes,
    mergeMode,
    client,
    isAsync,
    proxyConfig,
  }), [activeCollection.id, snippetSyncHashes, mergeMode, client, isAsync, proxyConfig]);

  useEffect(() => {
    setBackendOutputs({});
    setBackendMergedOutput(null);
    setBackendParserOutput(null);
  }, [client, isAsync, user, accessToken]);

  useEffect(() => {
    if (!user || !accessToken) {
      setHasLoadedRemoteWorkspace(false);
      return;
    }

    let active = true;
    getUserWorkspace(accessToken)
      .then((workspace) => {
        if (!active) return;
        let workspaceToLoad = workspace;
        try {
          const rawPending = window.localStorage.getItem(PENDING_WORKSPACE_KEY);
          if (rawPending) {
            const pending = JSON.parse(rawPending) as PendingWorkspacePayload;
            const pendingTime = Date.parse(pending.savedAt);
            const remoteTime = workspace.updatedAt ? Date.parse(workspace.updatedAt) : 0;
            if (pending.userId === user.id && Number.isFinite(pendingTime) && pendingTime > remoteTime) {
              workspaceToLoad = pending.payload;
              setWorkspaceSaveState("error");
              setStatusKind("error");
              setStatusMsg("Unsaved workspace changes restored");
            }
          }
        } catch {
          // Ignore malformed pending snapshots and keep the remote workspace.
        }
        if (workspaceToLoad.collections && Object.keys(workspaceToLoad.collections).length > 0) {
          const loadedCollections = normalizeCollections(workspaceToLoad.collections as Record<string, CollectionState>);
          setCollections(loadedCollections);
          if (workspaceToLoad.activeCollectionId && loadedCollections[workspaceToLoad.activeCollectionId]) {
            setActiveCollectionId(workspaceToLoad.activeCollectionId);
          }
          setOpenResponseTabs((workspaceToLoad.openResponseTabs as unknown as ResponseTab[]) || []);
          setActiveResponseTabId(workspaceToLoad.activeResponseTabId || null);
        }
        if (workspaceToLoad.theme === "light" || workspaceToLoad.theme === "dark") {
          setTheme(workspaceToLoad.theme);
        }
        setHasLoadedRemoteWorkspace(true);
      })
      .catch(() => {
        if (active) setHasLoadedRemoteWorkspace(true);
      });

    return () => {
      active = false;
    };
  }, [user, accessToken]);

  useEffect(() => {
    if (!user || !accessToken || !hasLoadedRemoteWorkspace) return;
    const timeout = window.setTimeout(() => {
      void saveWorkspacePayload(buildWorkspacePayload());
    }, 800);
    return () => window.clearTimeout(timeout);
  }, [user, accessToken, hasLoadedRemoteWorkspace, buildWorkspacePayload, saveWorkspacePayload]);

  // Status bar uses "snippets ready"
  useEffect(() => {
    const n = snippets.length;
    if (n === 0) {
      setStatusKind("info");
      setStatusMsg("Add a snippet to begin");
      return;
    }
    const empties = snippets.filter((s) => !s.raw.trim()).length;
    const dupes = Object.values(nameCounts).filter((c) => c > 1).length;
    if (errorCount > 0 || empties > 0) {
      setStatusKind("error");
      const firstErr = blocks.findIndex((b) => !b.raw.trim() || b.parsed.error);
      const sn = effectiveNames[firstErr] ?? "snippet";
      setStatusMsg(`Issue in ${sn} - others generated`);
    } else if (dupes > 0) {
      setStatusKind("error");
      setStatusMsg("Duplicate snippet name - auto-suffixed in output");
    } else if (mergeMode) {
      setStatusKind("success");
      setStatusMsg(`${n} snippet${n === 1 ? "" : "s"} ready - Merged into 2 files`);
    } else {
      setStatusKind("success");
      setStatusMsg(`${n} snippet${n === 1 ? "" : "s"} ready`);
    }
  }, [snippets, blocks, errorCount, mergeMode, nameCounts, effectiveNames]);

  // Focus the name input of newly-added snippet
  useEffect(() => {
    const id = focusNameOnMountId.current;
    if (id && nameInputRefs.current[id]) {
      nameInputRefs.current[id]?.focus();
      nameInputRefs.current[id]?.select();
      focusNameOnMountId.current = null;
    }
  }, [snippets]);

  useEffect(() => {
    setWorkspaceArtifacts((prev) => {
      const next = { ...prev };

      snippets.forEach((snippet, index) => {
        if (!next[snippet.id]) {
          next[snippet.id] = {
            responseJson: null,
            responseFileName: defaultResponseFileName(effectiveNames[index]),
            responseContentType: "application/json",
            responseExtension: "json",
            metaJson: null,
            logsTxt: `Workspace ${effectiveNames[index]} ready`,
            parserCode: buildParserStub(effectiveNames[index]),
            parserSelections: [],
            parserGenerated: true,
          };
        }
      });

      Object.keys(next).forEach((workspaceId) => {
        if (!snippets.some((snippet) => snippet.id === workspaceId)) {
          delete next[workspaceId];
        }
      });

      return next;
    });

    if (!activeWorkspaceId && snippets[0]) {
      setActiveWorkspaceId(snippets[0].id);
      setExpandedWorkspaceIds(new Set([snippets[0].id]));
    }

    if (activeWorkspaceId && !snippets.some((snippet) => snippet.id === activeWorkspaceId) && snippets[0]) {
      setActiveWorkspaceId(snippets[0].id);
      setExpandedWorkspaceIds(new Set([snippets[0].id]));
    }
  }, [snippets, effectiveNames, activeWorkspaceId]);

  const openResponseFile = (collectionId: string, workspaceId: string, fileNameOverride?: string, options?: { preserveWorkspaceTabs?: boolean }) => {
    const collection = collections[collectionId] ?? activeCollection;
    const collectionNames = collection.id === activeCollection.id ? effectiveNames : resolveEffectiveNames(collection.snippets);
    const workspaceIndex = collection.snippets.findIndex((snippet) => snippet.id === workspaceId);
    const workspaceName = workspaceIndex >= 0 ? collectionNames[workspaceIndex] : workspaceId;
    const artifact = collection.workspaceArtifacts[workspaceId];
    const fileName = fileNameOverride ?? artifact?.responseFileName ?? defaultResponseFileName(workspaceName);
    const tabId = `${collectionId}/${workspaceId}/${fileName}`;
    const tab: ResponseTab = {
      id: tabId,
      collectionId,
      workspaceId,
      fileName,
      label: fileName,
    };

    setOpenResponseTabs((prev) => {
      const base = options?.preserveWorkspaceTabs
        ? prev
        : prev.filter((item) => !(item.collectionId === collectionId && item.workspaceId === workspaceId));
      return base.some((item) => item.id === tabId) ? base.map((item) => item.id === tabId ? tab : item) : [...base, tab];
    });
    setActiveResponseTabId(tabId);
    setActivePanelTab("response");
  };

  const openWorkspaceFile = (workspaceId: string, file: WorkspaceFile, collectionId = activeCollection.id) => {
    setActiveWorkspaceId(workspaceId);
    setActiveWorkspaceFile(file);
    setExpandedWorkspaceIds((prev) => {
      const next = new Set(prev);
      next.add(workspaceId);
      return next;
    });

    if (file === "request.py") {
      const tabId = `req-${workspaceId}`;
      setActivePanelTab("code");
      setClosedTabIds((prev) => {
        if (!prev.has(tabId)) return prev;
        const next = new Set(prev);
        next.delete(tabId);
        return next;
      });
      setActiveTabId(tabId);
      return;
    }

    if (file === "parser.py" || file === "db.py" || file === "pipeline_utils.py") {
      const tabId = `req-${workspaceId}`;
      setActivePanelTab("code");
      setClosedTabIds((prev) => {
        if (!prev.has(tabId)) return prev;
        const next = new Set(prev);
        next.delete(tabId);
        return next;
      });
      setActiveTabId(tabId);
      return;
    }

    if (collectionId && collections[collectionId]?.workspaceArtifacts?.[workspaceId]?.responseOutputs?.[file]) {
      openResponseFile(collectionId, workspaceId, file);
      return;
    }

    if (isResponseFile(file) || file === "meta.json") {
      openResponseFile(collectionId, workspaceId);
      return;
    }

    setActivePanelTab("logs");
  };

  const toggleWorkspace = (workspaceId: string, collectionId = activeCollection.id) => {
    if (activeCollection.id !== collectionId) {
      setActiveCollectionId(collectionId);
    }
    setActiveWorkspaceId(workspaceId);
    setActiveWorkspaceFile("request.py");
    setExpandedWorkspaceIds((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceId)) next.delete(workspaceId);
      else next.add(workspaceId);
      return next;
    });
  };

  const selectCollection = (collectionId: string) => {
    const collection = collections[collectionId];
    if (!collection) return;
    setActiveCollectionId(collectionId);
    const existingSnippet = collection.snippets.find((snippet) => snippet.id === activeWorkspaceId);
    const firstSnippet = existingSnippet ?? collection.snippets[0];
    if (firstSnippet) {
      setActiveWorkspaceId(firstSnippet.id);
      setActiveWorkspaceFile("request.py");
      setActiveTabId(`req-${firstSnippet.id}`);
      setExpandedWorkspaceIds((prev) => new Set(prev).add(firstSnippet.id));
    } else {
      setActiveWorkspaceId("");
      setActiveTabId("");
    }
  };

  const toggleCollection = (collectionId: string) => {
    selectCollection(collectionId);
    setCollections((prev) => {
      const collection = prev[collectionId];
      if (!collection) return prev;
      return {
        ...prev,
        [collectionId]: {
          ...collection,
          expanded: !collection.expanded,
        },
      };
    });
  };

  const handleAddCollection = () => {
    let index = Object.keys(collections).length + 1;
    let name = `collection_${index}`;
    while (Object.values(collections).some((collection) => collection.name === name)) {
      index += 1;
      name = `collection_${index}`;
    }
    const id = newId();
    const collection = createCollection(id, name, [createDefaultSnippet("request_1")], true);
    const firstSnippet = collection.snippets[0];
    setCollections((prev) => ({
      ...prev,
      [id]: collection,
    }));
    setActiveCollectionId(id);
    setActiveWorkspaceId(firstSnippet.id);
    setActiveWorkspaceFile("request.py");
    setActiveTabId(`req-${firstSnippet.id}`);
    setExpandedWorkspaceIds((workspaceIds) => new Set(workspaceIds).add(firstSnippet.id));
  };

  const startRenameCollection = (collectionId: string) => {
    const collection = collections[collectionId];
    if (!collection) return;
    setEditingCollectionId(collectionId);
    setEditingCollectionName(collection.name);
  };

  const commitRenameCollection = () => {
    if (!editingCollectionId) return;
    const current = collections[editingCollectionId];
    if (!current) {
      setEditingCollectionId(null);
      return;
    }

    const nextName = sanitizeName(editingCollectionName) || current.name;
    const duplicate = Object.values(collections).some((collection) => collection.id !== editingCollectionId && collection.name === nextName);
    if (!nextName || duplicate) {
      setEditingCollectionName(current.name);
      setEditingCollectionId(null);
      if (duplicate) toast.error("Collection name already exists");
      return;
    }

    setCollections((prev) => {
      const oldCollection = prev[editingCollectionId];
      if (!oldCollection) return prev;
      return {
        ...prev,
        [editingCollectionId]: {
          ...oldCollection,
          name: nextName,
        },
      };
    });

    if (user && accessToken) {
      void renameConversionCollection(accessToken, editingCollectionId, { collection_name: nextName }).catch(() => {
        setStatusKind("error");
        setStatusMsg("Could not update collection history");
      });
    }
    setEditingCollectionId(null);
  };

  const handleDeleteCollection = (collectionId: string) => {
    const remainingCollections = Object.values(collections).filter((collection) => collection.id !== collectionId);
    if (user && accessToken) {
      void deleteConversionCollection(accessToken, collectionId).catch(() => {
        setStatusKind("error");
        setStatusMsg("Could not delete collection history");
      });
    }
    if (remainingCollections.length === 0) {
      const fallback = createCollection("tmp", "tmp", [], true);
      setCollections({ tmp: fallback });
      setActiveCollectionId("tmp");
      setActiveWorkspaceId("");
      setActiveTabId("");
      setOpenResponseTabs([]);
      setActiveResponseTabId(null);
      setStatusKind("info");
      setStatusMsg("Collection deleted");
      return;
    }

    const nextActiveCollection = activeCollectionId === collectionId
      ? remainingCollections[0]
      : collections[activeCollectionId] ?? remainingCollections[0];
    const firstSnippet = nextActiveCollection.snippets[0];

    setCollections((prev) => {
      const next = { ...prev };
      delete next[collectionId];
      return next;
    });
    setOpenResponseTabs((prev) => prev.filter((tab) => tab.collectionId !== collectionId));
    if (activeResponseTabId?.startsWith(`${collectionId}/`)) {
      const nextResponseTab = openResponseTabs.find((tab) => tab.collectionId !== collectionId);
      setActiveResponseTabId(nextResponseTab?.id ?? null);
    }
    setActiveCollectionId(nextActiveCollection.id);
    setActiveWorkspaceId(firstSnippet?.id ?? "");
    setActiveTabId(firstSnippet ? `req-${firstSnippet.id}` : "");
    setStatusKind("info");
    setStatusMsg("Collection deleted");
  };

  async function runWorkspace(workspaceId: string) {
    const workspaceIndex = snippets.findIndex((snippet) => snippet.id === workspaceId);
    if (workspaceIndex === -1) return;

    const workspaceName = effectiveNames[workspaceIndex] ?? snippets[workspaceIndex].name ?? `request_${workspaceIndex + 1}`;
    const requestSnippet = snippets[workspaceIndex];
    setActiveWorkspaceId(workspaceId);
    setActiveWorkspaceFile("request.py");
    setExpandedWorkspaceIds((prev) => new Set(prev).add(workspaceId));
    setStatusKind("info");
    setStatusMsg(`Running ${workspaceName}...`);

    if (!validateProxyConfig()) {
      return;
    }

    if (!requestSnippet || !requestSnippet.raw.trim()) {
      const errorMessage = "Add a curl command before running";
      setWorkspaceArtifacts((prev) => ({
        ...prev,
        [workspaceId]: {
          ...prev[workspaceId],
          responseJson: null,
          metaJson: null,
          logsTxt: `[error] ${errorMessage}`,
          parserCode: buildParserStub(workspaceName),
          parserGenerated: true,
        },
      }));
      setStatusKind("error");
      setStatusMsg(`Error in ${workspaceName}`);
      toast.error(errorMessage);
      return;
    }

    const requestCode = outputs[workspaceIndex] || "";
    const parserCode = workspaceArtifacts[workspaceId]?.parserCode ?? buildParserStub(workspaceName);

    try {
      const data = await runWorkspaceWithBackend({
        collection_name: activeCollection.name,
        workspace_name: workspaceName,
        request_code: requestCode,
        parser_code: parserCode,
        proxy: proxyConfig,
        useBackendProxy: !!requestSnippet.useBackendProxy,
      });

      const responsePayload = data.parsed ?? data.response ?? { error: data.error || "Execution failed", logs: data.logs };
      const responseJson = data.extension === "txt" && typeof responsePayload === "string"
        ? responsePayload
        : JSON.stringify(responsePayload, null, 2);
      const meta = {
        status: data.status,
        time_ms: data.time_ms,
        size: data.size,
        content_type: data.content_type,
      };
      const responseFileName = data.response_file_name ?? data.file_name ?? `${workspaceName}_response.${data.extension || "json"}`;

      setWorkspaceArtifacts((prev) => ({
        ...prev,
        [workspaceId]: {
          ...prev[workspaceId],
          responseJson,
          responseFileName,
          responseContentType: data.content_type,
          responseExtension: data.extension,
          responseOutputs: {
            ...prev[workspaceId]?.responseOutputs,
            [responseFileName]: {
              content: responseJson,
              contentType: data.content_type,
              extension: data.extension,
              metaJson: JSON.stringify(meta, null, 2),
            },
          },
          metaJson: JSON.stringify(meta, null, 2),
          logsTxt: data.logs,
          parserCode,
        },
      }));

      setActivePanelTab("response");
      openResponseFile(activeCollection.id, workspaceId, responseFileName);

      if (data.success) {
        setStatusKind("success");
        setStatusMsg(`Completed ${workspaceName} in ${data.time_ms}ms`);
        toast.success(`Ran ${workspaceName}`);
      } else {
        setStatusKind("error");
        setStatusMsg(`Error in ${workspaceName}`);
        toast.error(data.error || data.logs || "Execution failed");
      }
      return {
        responseJson,
        responseContentType: data.content_type,
        responseFileName,
        responseExtension: data.extension,
      };
    } catch (error) {
      const message = extractApiErrorMessage(error);
      const meta = {
        status: null,
        time_ms: 0,
        size: "0 KB",
      };
      setWorkspaceArtifacts((prev) => ({
        ...prev,
        [workspaceId]: {
          ...prev[workspaceId],
          responseJson: JSON.stringify({ error: message }, null, 2),
          responseFileName: defaultResponseFileName(workspaceName),
          responseContentType: "application/json",
          responseExtension: "json",
          metaJson: JSON.stringify(meta, null, 2),
          logsTxt: message,
          parserCode,
        },
      }));
      openResponseFile(activeCollection.id, workspaceId);
      setStatusKind("error");
      setStatusMsg(`Error in ${workspaceName}`);
      toast.error(message);
      return null;
    }
  }

  // Load divider position from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("curl2py:divider-pos");
    if (saved) {
      const pos = parseFloat(saved);
      if (!isNaN(pos) && pos >= 30 && pos <= 70) {
        setDividerPos(pos);
      }
    }
  }, []);

  // Save divider position to localStorage
  useEffect(() => {
    localStorage.setItem("curl2py:divider-pos", dividerPos.toString());
  }, [dividerPos]);

  // Handle divider drag
  useEffect(() => {
    if (!isDraggingDivider) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!mainRef.current) return;
      const rect = mainRef.current.getBoundingClientRect();
      const newX = e.clientX - rect.left;
      const percentage = (newX / rect.width) * 100;

      // Constrain to 30-70% range
      const constrained = Math.max(30, Math.min(70, percentage));
      setDividerPos(constrained);
    };

    const handleMouseUp = () => {
      setIsDraggingDivider(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingDivider]);

  // Snippet handlers
  const updateSnippet = (id: string, patch: Partial<Snippet>) => {
    setSnippets((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const handleNameChange = (id: string, raw: string) => {
    updateSnippet(id, { name: sanitizeName(raw) });
  };

  const handleAddSnippet = () => {
    setSnippets((prev) => {
      // Find next unused request_N
      const existing = new Set(prev.map((s) => s.name));
      let i = prev.length + 1;
      let name = `request_${i}`;
      while (existing.has(name)) {
        i += 1;
        name = `request_${i}`;
      }
      const id = newId();
      focusNameOnMountId.current = id;
      const next = [...prev, { id, name, raw: "", useBackendProxy: false }];
      // scroll into view next tick
      setTimeout(() => {
        snippetRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "end" });
      }, 30);
      return next;
    });
  };

  const handleRemoveSnippet = (id: string) => {
    delete lastSyncedSnippetHashesRef.current[id];
    if (user && accessToken) {
      void deleteConversionSnippet(accessToken, activeCollection.id, id).catch(() => {
        setStatusKind("error");
        setStatusMsg("Could not delete snippet history");
      });
    }
    setSnippets((prev) => prev.filter((s) => s.id !== id));
  };

  const toggleCollapse = (id: string) => {
    setSnippets((prev) => prev.map((s) => (s.id === id ? { ...s, collapsed: !s.collapsed } : s)));
  };

  const moveSnippet = (id: string, dir: -1 | 1) => {
    setSnippets((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx === -1) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const reorderSnippets = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setSnippets((prev) => {
      const from = prev.findIndex((s) => s.id === sourceId);
      const to = prev.findIndex((s) => s.id === targetId);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const focusSnippet = (id: string) => {
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx === -1) return;
    setActiveWorkspaceId(id);
    setActiveWorkspaceFile("request.py");
    setActivePanelTab("code");
    setExpandedWorkspaceIds((prev) => new Set(prev).add(id));
    const reqTab = allTabs.find((t) => t.kind === "request" && t.reqIdx === idx);
    if (reqTab) {
      setClosedTabIds((prev) => {
        if (!prev.has(reqTab.id)) return prev;
        const next = new Set(prev);
        next.delete(reqTab.id);
        return next;
      });
      setActiveTabId(reqTab.id);
    }
  };

  // Click output tab to scroll to snippet
  useEffect(() => {
    if (!activeTab || activeTab.kind !== "request" || activeReqIdx == null) return;
    const block = blocks[activeReqIdx];
    if (!block) return;
    const el = snippetRefs.current[block.id];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeTabId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Output handlers
  const getActivePanelFilename = () => {
    if (activeWorkspaceFile === "db.py") {
      return "db.py";
    }
    if (activeWorkspaceFile === "parser.py") {
      return "parser.py";
    }
    if (activeWorkspaceFile === "pipeline_utils.py") {
      return "pipeline_utils.py";
    }
    if (activePanelTab === "response") {
      return activeResponseTab?.label ?? activeWorkspaceFile;
    }
    if (activePanelTab === "logs") {
      return "logs.txt";
    }
    if (activePanelTab === "parser") {
      return "parser.py";
    }
    return panelCodeFilename;
  };

  const getActivePanelContent = () => {
    if (activeWorkspaceFile === "db.py") {
      return activeWorkspaceArtifact?.dbCode || "";
    }
    if (activeWorkspaceFile === "parser.py") {
      return activeWorkspaceArtifact?.parserCode ?? buildParserStub(activeWorkspaceDisplayName);
    }
    if (activeWorkspaceFile === "pipeline_utils.py") {
      return PIPELINE_UTILS_CODE;
    }
    if (activePanelTab === "response") {
      return activeWorkspaceFile === "meta.json"
        ? activeResponseArtifact?.metaJson || activeMetaJson || ""
        : activeResponseJson || "";
    }
    if (activePanelTab === "logs") {
      return activeLogsTxt || "";
    }
    if (activePanelTab === "parser") {
      return activeWorkspaceArtifact?.parserCode ?? buildParserStub(activeWorkspaceDisplayName);
    }
    return panelCodeContent;
  };

  const handleCodePanelChange = (value: string) => {
    if (!activeTab || activePanelTab !== "code") return;
    setDirtyCodeTabs((prev) => ({ ...prev, [activeTab.id]: true }));

    if (activeWorkspaceFile === "db.py" && activeWorkspaceId) {
      updateWorkspaceArtifact(activeWorkspaceId, (artifact) => ({ ...artifact, dbCode: value }));
      return;
    }

    if (activeWorkspaceFile === "parser.py" && activeWorkspaceId) {
      updateWorkspaceArtifact(activeWorkspaceId, (artifact) => ({ ...artifact, parserCode: value, parserGenerated: false }));
      return;
    }

    if (activeWorkspaceFile === "pipeline_utils.py") {
      return;
    }

    if (activeTab.kind === "merged") {
      setBackendMergedOutput(value);
      return;
    }

    if (activeTab.kind === "request" && activeTab.reqIdx != null) {
      const block = blocks[activeTab.reqIdx];
      if (block) {
        let nextValue = value;
        try {
          nextValue = repairPythonPipelinePlaceholders(value);
        } catch {
          nextValue = value;
        }
        delete lastSyncedSnippetHashesRef.current[block.id];
        lastSuccessfulSyncKeyRef.current = null;
        setBackendOutputs((prev) => ({ ...prev, [block.id]: nextValue }));
      }
    }
  };

  const handleCopyActive = async () => {
    const content = getActivePanelContent();
    if (!content) return;
    try {
      const copied = await copyToClipboard(content);
      if (copied) {
        setCopiedAll(true);
        setTimeout(() => setCopiedAll(false), 1400);
        toast.success("Copied");
        return;
      }
    } catch {
      // Fall through to the friendly toast below.
    }

    toast.error("Copy failed. Use HTTPS or localhost.");
  };

  const downloadFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: "text/x-python;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadActive = () => {
    const content = getActivePanelContent();
    if (!content) return;
    downloadFile(getActivePanelFilename(), content);
  };

  const activePanelContent = getActivePanelContent();
  const hasActivePanelContent = activePanelContent.length > 0;
  const currentFileActions = (
    <div className="flex items-center gap-1">
      {activePanelTab === "code" && (
        <button
          onClick={() => setCodeWordWrap((prev) => !prev)}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-sm border border-border bg-background/40 text-muted-foreground transition-colors hover:border-border-strong hover:bg-surface-elevated hover:text-foreground",
            codeWordWrap && "border-primary/50 bg-primary/10 text-primary"
          )}
          title={codeWordWrap ? "Disable word wrap" : "Enable word wrap"}
          aria-label={codeWordWrap ? "Disable word wrap" : "Enable word wrap"}
        >
          <WrapText className="h-3 w-3" strokeWidth={2} />
        </button>
      )}
      <button
        onClick={handleCopyActive}
        disabled={!hasActivePanelContent}
        className="flex h-6 w-6 items-center justify-center rounded-sm border border-border bg-background/40 text-muted-foreground transition-colors hover:border-border-strong hover:bg-surface-elevated hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
        title="Copy current file"
        aria-label="Copy current file"
      >
        {copiedAll ? (
          <Check className="h-3 w-3 animate-check-in text-success" strokeWidth={2.5} />
        ) : (
          <Copy className="h-3 w-3" strokeWidth={2} />
        )}
      </button>
      <button
        onClick={handleDownloadActive}
        disabled={!hasActivePanelContent}
        className="flex h-6 w-6 items-center justify-center rounded-sm border border-border bg-background/40 text-muted-foreground transition-colors hover:border-border-strong hover:bg-surface-elevated hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
        title="Download current file"
        aria-label="Download current file"
      >
        <Download className="h-3 w-3" strokeWidth={2} />
      </button>
    </div>
  );

  const writeParserSelectionsToArtifact = (
    collectionId: string,
    workspaceId: string,
    workspaceName: string,
    nextSelections: ParserSelection[],
  ) => {
    const sourceJson = manualParserJsonByWorkspace[workspaceId] ?? collections[collectionId]?.workspaceArtifacts?.[workspaceId]?.responseJson ?? null;
    const codeSelections = filterSelectionsByJsonSource(nextSelections, sourceJson);
    const parserCode = codeSelections.length > 0
      ? generateParserCode(workspaceName, codeSelections, scriptJsonParserByWorkspace[workspaceId] ? "script_json" : "response_json")
      : buildParserStub(workspaceName);

    setCollections((prev) => {
      const collection = prev[collectionId];
      if (!collection) return prev;
      const artifacts = collection.workspaceArtifacts || {};
      const artifact = artifacts[workspaceId] ?? {
        responseJson: null,
        responseFileName: defaultResponseFileName(workspaceName),
        responseContentType: "application/json",
        responseExtension: "json",
        metaJson: null,
        logsTxt: `Workspace ${workspaceName} ready`,
        parserCode: buildParserStub(workspaceName),
        parserSelections: [],
        parserGenerated: true,
      };

      return {
        ...prev,
        [collectionId]: {
          ...collection,
          workspaceArtifacts: {
            ...artifacts,
            [workspaceId]: {
              ...artifact,
              parserSelections: nextSelections,
              parserCode,
              parserGenerated: true,
            },
          },
        },
      };
    });
  };

  const writeHtmlParserSelectionsToArtifact = (
    collectionId: string,
    workspaceId: string,
    workspaceName: string,
    nextSelections: ParserSelection[],
  ) => {
    const parserCode = safeGenerateHtmlParserCode(workspaceName, nextSelections);

    setCollections((prev) => {
      const collection = prev[collectionId];
      if (!collection) return prev;
      const artifacts = collection.workspaceArtifacts || {};
      const artifact = artifacts[workspaceId] ?? {
        responseJson: null,
        responseFileName: `${workspaceName}_response.html`,
        responseContentType: "text/html",
        responseExtension: "html",
        metaJson: null,
        logsTxt: `Workspace ${workspaceName} ready`,
        parserCode: buildParserStub(workspaceName),
        parserSelections: [],
        htmlParserSelections: [],
        parserGenerated: true,
      };

      return {
        ...prev,
        [collectionId]: {
          ...collection,
          workspaceArtifacts: {
            ...artifacts,
            [workspaceId]: {
              ...artifact,
              htmlParserSelections: nextSelections,
              parserCode,
              parserGenerated: true,
            },
          },
        },
      };
    });
  };

  const addSelectedPathToParser = (path?: string) => {
    const selectedPath = typeof path === "string" ? path : selectedParserPath;
    const targetCollection = isParserRoute ? parserCollection : activeCollection;
    const targetNames = targetCollection.id === activeCollection.id ? effectiveNames : resolveEffectiveNames(targetCollection.snippets);
    const workspaceId = isParserRoute ? parserWorkspaceId : activeResponseTab?.workspaceId || activeWorkspaceId;
    const requestKey = isParserRoute ? activeParserRequestKey : workspaceId ? `${targetCollection.id}:${workspaceId}` : "";

    console.debug("selectedPath before add", selectedPath);
    console.debug("activeRequestKey", requestKey);

    if (!selectedPath || !workspaceId || !requestKey) return;
    if (parserResponseJson?.trim() && !jsonPathExistsInSource(parserResponseJson, selectedPath)) {
      toast.error("Path not found in JSON");
      return;
    }
    const workspaceIndex = targetCollection.snippets.findIndex((snippet) => snippet.id === workspaceId);
    const hasManualJsonSource = !!manualParserJsonByWorkspace[workspaceId] || (workspaceId === parserWorkspaceId && !!parserResponseJson);
    if (workspaceIndex === -1 && !hasManualJsonSource) return;
    const workspaceName = workspaceIndex >= 0
      ? targetNames[workspaceIndex] ?? targetCollection.snippets[workspaceIndex].name ?? `request_${workspaceIndex + 1}`
      : parserWorkspaceName || "manual_json";

    setParserSelectionsByRequest((prev) => {
      const currentSelections = prev[requestKey] ?? (isScriptJsonRoute ? [] : targetCollection.workspaceArtifacts?.[workspaceId]?.parserSelections ?? []);
      if (currentSelections.some((selection) => selection.path === selectedPath)) {
        toast.info("Path already added");
        console.debug("new parser selections", currentSelections);
        return prev;
      }

      const nextSelection: ParserSelection = {
        id: newId(),
        path: selectedPath,
        outputKey: uniqueOutputKey(getOutputKeyFromPath(selectedPath), currentSelections),
        selectionMode: "single",
      };
      const nextSelections: ParserSelection[] = [
        ...currentSelections,
        nextSelection,
      ];
      console.debug("new parser selections", nextSelections);
      if (!isScriptJsonRoute) writeParserSelectionsToArtifact(targetCollection.id, workspaceId, workspaceName, nextSelections);
      toast.success(`Added path: ${selectedPath}`);
      return {
        ...prev,
        [requestKey]: nextSelections,
      };
    });

    setActiveWorkspaceId(workspaceId);
    setActiveWorkspaceFile("parser.py");
  };

  const addPathToParser = (path: string, options: { replaceCustomParser?: boolean } = {}) => {
    const targetCollection = isParserRoute ? parserCollection : activeCollection;
    const targetNames = targetCollection.id === activeCollection.id ? effectiveNames : resolveEffectiveNames(targetCollection.snippets);
    const workspaceId = isParserRoute ? parserWorkspaceId : activeResponseTab?.workspaceId || activeWorkspaceId;
    if (!workspaceId) return;
    const workspaceIndex = targetCollection.snippets.findIndex((snippet) => snippet.id === workspaceId);
    const hasManualJsonSource = !!manualParserJsonByWorkspace[workspaceId] || (workspaceId === parserWorkspaceId && !!parserResponseJson);
    if (workspaceIndex === -1 && !hasManualJsonSource) return;
    if (parserResponseJson?.trim() && !jsonPathExistsInSource(parserResponseJson, path)) {
      toast.error("Path not found in JSON");
      return;
    }
    const workspaceName = workspaceIndex >= 0
      ? targetNames[workspaceIndex] ?? targetCollection.snippets[workspaceIndex].name ?? `request_${workspaceIndex + 1}`
      : parserWorkspaceName || "manual_json";
    const parts = normalizeSelectionParts(path).filter((part): part is string | number => part !== undefined);
    const lastKey = [...parts].reverse().find((part): part is string => typeof part === "string");
    if (!lastKey) return;

    setCollections((prev) => {
      const collection = prev[targetCollection.id];
      if (!collection) return prev;
      const artifacts = collection.workspaceArtifacts || {};
      const artifact = artifacts[workspaceId] ?? {
        responseJson: null,
        responseFileName: defaultResponseFileName(workspaceName),
        responseContentType: "application/json",
        responseExtension: "json",
        metaJson: null,
        logsTxt: `Workspace ${workspaceName} ready`,
        parserCode: buildParserStub(workspaceName),
        parserSelections: [],
        parserGenerated: true,
      };
      const existingSelections = artifact.parserSelections ?? [];
      if (existingSelections.some((selection) => selection.path === path)) {
        toast.info("Path already added");
        return prev;
      }

      const isGeneratedParser = artifact.parserGenerated || artifact.parserCode === buildParserStub(workspaceName);
      if (!isGeneratedParser && !options.replaceCustomParser) {
        setPendingParserReplacePath(path);
        return prev;
      }

      const outputKey = uniqueOutputKey(sanitizeOutputKey(lastKey), existingSelections);
      const parserSelections = [...existingSelections, { path, outputKey, selectionMode: "single" as const }];
      const parserCode = generateParserCode(workspaceName, parserSelections);
      toast.success("Path added");
      return {
        ...prev,
        [targetCollection.id]: {
          ...collection,
          workspaceArtifacts: {
            ...artifacts,
            [workspaceId]: {
              ...artifact,
              parserSelections,
              parserCode,
              parserGenerated: true,
            },
          },
        },
      };
    });

    setActiveWorkspaceId(workspaceId);
    setActiveWorkspaceFile("parser.py");
  };

  const removePathFromParser = (path: string) => {
    const targetCollection = isParserRoute ? parserCollection : activeCollection;
    const targetNames = targetCollection.id === activeCollection.id ? effectiveNames : resolveEffectiveNames(targetCollection.snippets);
    const workspaceId = isParserRoute ? parserWorkspaceId : activeResponseTab?.workspaceId || activeWorkspaceId;
    const requestKey = isParserRoute ? activeParserRequestKey : workspaceId ? `${targetCollection.id}:${workspaceId}` : "";
    if (!path || !workspaceId || !requestKey) return;
    const workspaceIndex = targetCollection.snippets.findIndex((snippet) => snippet.id === workspaceId);
    const hasManualJsonSource = !!manualParserJsonByWorkspace[workspaceId] || (workspaceId === parserWorkspaceId && !!parserResponseJson);
    if (workspaceIndex === -1 && !hasManualJsonSource) return;
    const workspaceName = workspaceIndex >= 0
      ? targetNames[workspaceIndex] ?? targetCollection.snippets[workspaceIndex].name ?? `request_${workspaceIndex + 1}`
      : parserWorkspaceName || "manual_json";

    setParserSelectionsByRequest((prev) => {
      const currentSelections = prev[requestKey] ?? (isScriptJsonRoute ? [] : targetCollection.workspaceArtifacts?.[workspaceId]?.parserSelections ?? []);
      const nextSelections = currentSelections.filter((selection) => selection.path !== path);
      if (nextSelections.length === currentSelections.length) {
        toast.info("Path was not added");
        return prev;
      }
      if (!isScriptJsonRoute) writeParserSelectionsToArtifact(targetCollection.id, workspaceId, workspaceName, nextSelections);
      toast.success(`Removed path: ${path}`);
      return {
        ...prev,
        [requestKey]: nextSelections,
      };
    });
  };

  const addHtmlPathToParser = (selection: ParserSelection) => {
    try {
      const targetCollection = isParserRoute ? parserCollection : activeCollection;
      const targetNames = targetCollection.id === activeCollection.id ? effectiveNames : resolveEffectiveNames(targetCollection.snippets);
      const workspaceId = isParserRoute ? parserWorkspaceId : activeResponseTab?.workspaceId || activeWorkspaceId;
      const requestKey = workspaceId ? `${targetCollection.id}:${workspaceId}` : "";
      const selectorType = selection.selectorType ?? "xpath";
      const selector = selection.selector || (selectorType === "css" ? selection.css : selection.xpath) || selection.path;

      if (!selector || !workspaceId || !requestKey) return;
      const workspaceIndex = targetCollection.snippets.findIndex((snippet) => snippet.id === workspaceId);
      if (workspaceIndex === -1) return;
      const workspaceName = targetNames[workspaceIndex] ?? targetCollection.snippets[workspaceIndex].name ?? `request_${workspaceIndex + 1}`;

      setHtmlParserSelectionsByRequest((prev) => {
        const currentSelections = prev[requestKey] ?? targetCollection.workspaceArtifacts?.[workspaceId]?.htmlParserSelections ?? [];
        const nextSelection: ParserSelection = {
          id: newId(),
          path: selector,
          selector,
          xpath: selection.xpath || (selectorType === "xpath" ? selector : ""),
          css: selection.css || (selectorType === "css" ? selector : ""),
          selectorType,
          extractMode: selection.extractMode ?? selection.valueMode ?? "text",
          valueMode: selection.extractMode ?? selection.valueMode ?? "text",
          attrName: (selection.extractMode ?? selection.valueMode) === "attr" ? selection.attrName ?? "" : "",
          outputKey: uniqueOutputKey(selection.outputKey || getOutputKeyFromHtmlSelector(selector), currentSelections),
          parentSelector: selection.parentSelector,
          parentSelectorType: selection.parentSelectorType,
          parentXpath: selection.parentXpath,
          parentCss: selection.parentCss,
          relativeSelector: selection.relativeSelector,
          relativeXpath: selection.relativeXpath,
          relativeCss: selection.relativeCss,
        };

        if (currentSelections.some((item) => getHtmlSelectorMappingKey(item) === getHtmlSelectorMappingKey(nextSelection))) {
          toast.info("Selector already added");
          return prev;
        }

        const nextSelections = [
          ...currentSelections,
          nextSelection,
        ];
        writeHtmlParserSelectionsToArtifact(targetCollection.id, workspaceId, workspaceName, nextSelections);
        toast.success("Path added");
        return {
          ...prev,
          [requestKey]: nextSelections,
        };
      });

      setActiveWorkspaceId(workspaceId);
      setActiveWorkspaceFile("parser.py");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add selector");
    }
  };

  const removeHtmlPathFromParser = (selection: ParserSelection) => {
    const targetCollection = isParserRoute ? parserCollection : activeCollection;
    const targetNames = targetCollection.id === activeCollection.id ? effectiveNames : resolveEffectiveNames(targetCollection.snippets);
    const workspaceId = isParserRoute ? parserWorkspaceId : activeResponseTab?.workspaceId || activeWorkspaceId;
    const requestKey = workspaceId ? `${targetCollection.id}:${workspaceId}` : "";
    const selector = selection.selector || selection.path || selection.xpath || selection.css || "";
    if (!selector || !workspaceId || !requestKey) return;
    const workspaceIndex = targetCollection.snippets.findIndex((snippet) => snippet.id === workspaceId);
    if (workspaceIndex === -1) return;
    const workspaceName = targetNames[workspaceIndex] ?? targetCollection.snippets[workspaceIndex].name ?? `request_${workspaceIndex + 1}`;
    const selectionKey = getHtmlSelectorMappingKey({
      ...selection,
      selector,
      path: selection.path || selector,
    });

    setHtmlParserSelectionsByRequest((prev) => {
      const currentSelections = prev[requestKey] ?? targetCollection.workspaceArtifacts?.[workspaceId]?.htmlParserSelections ?? [];
      const nextSelections = currentSelections.filter((item) => getHtmlSelectorMappingKey(item) !== selectionKey);
      if (nextSelections.length === currentSelections.length) {
        toast.info("Path was not added");
        return prev;
      }
      writeHtmlParserSelectionsToArtifact(targetCollection.id, workspaceId, workspaceName, nextSelections);
      toast.success("Path removed");
      return {
        ...prev,
        [requestKey]: nextSelections,
      };
    });
  };

  const updateParserSelectionsForWorkspace = (
    workspaceId: string,
    updater: ParserSelection[] | ((prev: ParserSelection[]) => ParserSelection[]),
  ) => {
    const targetCollection = isParserRoute ? parserCollection : activeCollection;
    const targetNames = targetCollection.id === activeCollection.id ? effectiveNames : resolveEffectiveNames(targetCollection.snippets);
    const workspaceIndex = targetCollection.snippets.findIndex((snippet) => snippet.id === workspaceId);
    const hasManualJsonSource = !!manualParserJsonByWorkspace[workspaceId] || (workspaceId === parserWorkspaceId && !!parserResponseJson);
    if (workspaceIndex === -1 && !hasManualJsonSource) return;
    const workspaceName = workspaceIndex >= 0
      ? targetNames[workspaceIndex] ?? targetCollection.snippets[workspaceIndex].name ?? `request_${workspaceIndex + 1}`
      : parserWorkspaceName || "manual_json";
    const requestKey = `${targetCollection.id}:${workspaceId}`;

    setParserSelectionsByRequest((prev) => {
      const currentRequestKey = isScriptJsonRoute ? activeParserRequestKey : requestKey;
      const currentSelections = prev[currentRequestKey] ?? (isScriptJsonRoute ? [] : targetCollection.workspaceArtifacts?.[workspaceId]?.parserSelections ?? []);
      const nextSelections = typeof updater === "function"
        ? (updater as (prev: ParserSelection[]) => ParserSelection[])(currentSelections)
        : updater;
      if (!isScriptJsonRoute) writeParserSelectionsToArtifact(targetCollection.id, workspaceId, workspaceName, nextSelections);
      return {
        ...prev,
        [currentRequestKey]: nextSelections,
      };
    });
  };

  const updateParserSelectionRow = (index: number, patch: Partial<ParserSelection>) => {
    if (!parserWorkspaceId) return;
    updateParserSelectionsForWorkspace(parserWorkspaceId, (prev) => prev.map((selection, rowIndex) => (
      rowIndex === index ? { ...selection, ...patch } : selection
    )));
  };

  const updateHtmlParserSelectionRow = (index: number, patch: Partial<ParserSelection>) => {
    if (!parserWorkspaceId) return;
    const targetCollection = isParserRoute ? parserCollection : activeCollection;
    const targetNames = targetCollection.id === activeCollection.id ? effectiveNames : resolveEffectiveNames(targetCollection.snippets);
    const workspaceIndex = targetCollection.snippets.findIndex((snippet) => snippet.id === parserWorkspaceId);
    if (workspaceIndex === -1) return;
    const workspaceName = targetNames[workspaceIndex] ?? targetCollection.snippets[workspaceIndex].name ?? `request_${workspaceIndex + 1}`;
    const requestKey = `${targetCollection.id}:${parserWorkspaceId}`;

    setHtmlParserSelectionsByRequest((prev) => {
      const currentSelections = prev[requestKey] ?? targetCollection.workspaceArtifacts?.[parserWorkspaceId]?.htmlParserSelections ?? [];
      const nextSelections = currentSelections.map((selection, rowIndex) => {
        if (rowIndex !== index) return selection;
        const previousType = selection.selectorType ?? "xpath";
        const nextType = patch.selectorType ?? previousType;
        const typedSelector = patch.selector ?? selection.selector ?? selection.path;
        const nextXpath = patch.xpath ?? (previousType === "xpath" && patch.selector !== undefined ? patch.selector : selection.xpath) ?? (previousType === "xpath" ? typedSelector : "");
        const nextCss = patch.css ?? (previousType === "css" && patch.selector !== undefined ? patch.selector : selection.css) ?? (previousType === "css" ? typedSelector : "");
        const visibleSelector = patch.selectorType
          ? (nextType === "css" ? nextCss || xpathToCssFallback(nextXpath || typedSelector) : nextXpath || cssToXpathFallback(nextCss || typedSelector))
          : typedSelector;
        const mode = patch.extractMode ?? patch.valueMode ?? selection.extractMode ?? selection.valueMode ?? "text";
        const visibleXpath = nextType === "xpath" ? visibleSelector : nextXpath;
        const visibleCss = nextType === "css" ? visibleSelector : nextCss;

        return {
          ...selection,
          ...patch,
          xpath: visibleXpath,
          css: visibleCss,
          selectorType: nextType,
          extractMode: mode,
          valueMode: mode,
          attrName: mode === "attr" ? patch.attrName ?? selection.attrName ?? "" : "",
          path: visibleSelector,
          selector: visibleSelector,
        };
      });
      writeHtmlParserSelectionsToArtifact(targetCollection.id, parserWorkspaceId, workspaceName, nextSelections);
      return { ...prev, [requestKey]: nextSelections };
    });
  };

  const addManualParserPath = () => {
    if (!parserWorkspaceId) return;
    updateParserSelectionsForWorkspace(parserWorkspaceId, (prev) => [
      ...prev,
      {
        path: "",
        outputKey: uniqueOutputKey("value", prev),
        selectionMode: "single",
      },
    ]);
  };

  const deleteParserSelectionRow = (index: number) => {
    if (!parserWorkspaceId) return;
    updateParserSelectionsForWorkspace(parserWorkspaceId, (prev) => prev.filter((_, rowIndex) => rowIndex !== index));
  };

  const addManualHtmlPath = () => {
    addHtmlPathToParser({
      path: "//div",
      selector: "//div",
      xpath: "//div",
      css: "div",
      selectorType: "xpath",
      outputKey: uniqueOutputKey("value", htmlParserSelections),
      extractMode: "text",
      valueMode: "text",
    });
  };

  const deleteHtmlParserSelectionRow = (index: number) => {
    if (!parserWorkspaceId) return;
    const targetCollection = isParserRoute ? parserCollection : activeCollection;
    const targetNames = targetCollection.id === activeCollection.id ? effectiveNames : resolveEffectiveNames(targetCollection.snippets);
    const workspaceIndex = targetCollection.snippets.findIndex((snippet) => snippet.id === parserWorkspaceId);
    if (workspaceIndex === -1) return;
    const workspaceName = targetNames[workspaceIndex] ?? targetCollection.snippets[workspaceIndex].name ?? `request_${workspaceIndex + 1}`;
    const requestKey = `${targetCollection.id}:${parserWorkspaceId}`;

    setHtmlParserSelectionsByRequest((prev) => {
      const currentSelections = prev[requestKey] ?? targetCollection.workspaceArtifacts?.[parserWorkspaceId]?.htmlParserSelections ?? [];
      const nextSelections = currentSelections.filter((_, rowIndex) => rowIndex !== index);
      writeHtmlParserSelectionsToArtifact(targetCollection.id, parserWorkspaceId, workspaceName, nextSelections);
      return { ...prev, [requestKey]: nextSelections };
    });
  };

  const saveParserJson = () => {
    const workspaceId = parserWorkspaceId || MANUAL_PARSER_WORKSPACE_ID;
    if (!parserJsonDraft.trim()) return;
    try {
      const sourceJson = preserveValidatedJsonSource(parserJsonDraft);
      if (isScriptJsonRoute && scriptJsonSourceKey && activeScriptJsonSource) {
        setScriptJsonSourcesByRequest((prev) => ({
          ...prev,
          [scriptJsonSourceKey]: {
            ...activeScriptJsonSource,
            json: sourceJson,
          },
        }));
        setParserJsonDraft(sourceJson);
        setIsEditingParserJson(false);
        toast.success("JSON saved");
        return;
      }
      setManualParserJsonByWorkspace((prev) => ({
        ...prev,
        [workspaceId]: sourceJson,
      }));
      setCollections((prev) => {
        const targetCollection = isParserRoute ? parserCollection : activeCollection;
        const collection = prev[targetCollection.id];
        if (!collection) return prev;
        const artifacts = collection.workspaceArtifacts || {};
        const currentArtifact = artifacts[workspaceId] ?? {
          responseJson: null,
          metaJson: null,
          logsTxt: `Workspace ${parserWorkspaceName} ready`,
          parserCode: buildParserStub(parserWorkspaceName),
        };
        return {
          ...prev,
          [targetCollection.id]: {
            ...collection,
            workspaceArtifacts: {
              ...artifacts,
              [workspaceId]: {
                ...currentArtifact,
                responseJson: sourceJson,
                responseContentType: "application/json",
                responseExtension: "json",
                responseFileName: "manual_response.json",
              },
            },
          },
        };
      });
      setParserJsonDraft(sourceJson);
      setIsEditingParserJson(false);
      toast.success("JSON saved");
    } catch {
      toast.error("Invalid JSON. Please check syntax.");
    }
  };

  const saveDbJsonSource = () => {
    const workspaceId = parserWorkspaceId || MANUAL_PARSER_WORKSPACE_ID;
    const requestKey = activeParserRequestKey || `${parserCollection.id}:${workspaceId}`;
    let nextSource: string;
    try {
      nextSource = preserveValidatedJsonSource(dbJsonDraft);
    } catch {
      toast.error("Invalid JSON. Please check syntax.");
      return;
    }
    const nextGeneration = generateMysqlDbCode(nextSource, parserWorkspaceName);

    setDbJsonByRequest((prev) => ({
      ...prev,
      [requestKey]: nextSource,
    }));

    setCollections((prev) => {
      const collection = prev[parserCollection.id];
      if (!collection) return prev;
      const artifacts = collection.workspaceArtifacts || {};
      const currentArtifact = artifacts[workspaceId] ?? {
        responseJson: null,
        responseFileName: defaultResponseFileName(parserWorkspaceName),
        responseContentType: "application/json",
        responseExtension: "json",
        metaJson: null,
        logsTxt: `Workspace ${parserWorkspaceName} ready`,
        parserCode: buildParserStub(parserWorkspaceName),
        parserGenerated: true,
      };
      return {
        ...prev,
        [parserCollection.id]: {
          ...collection,
          workspaceArtifacts: {
            ...artifacts,
            [workspaceId]: {
              ...currentArtifact,
              dbSourceJson: nextSource,
              dbCode: nextGeneration.error ? currentArtifact.dbCode : nextGeneration.code,
            },
          },
        },
      };
    });

    setIsEditingDbJson(false);
    if (nextGeneration.error) {
      toast.error(nextGeneration.error);
    } else {
      toast.success("JSON Source saved");
    }
  };

  const saveDbCodeForWorkspace = () => {
    const workspaceId = parserWorkspaceId || activeWorkspaceId || MANUAL_PARSER_WORKSPACE_ID;
    if (!workspaceId || dbGeneration.error) {
      toast.error(dbGeneration.error || "No DB code to save");
      return;
    }
    const targetCollection = isParserRoute ? parserCollection : activeCollection;
    const workspaceName = parserWorkspaceName || activeWorkspaceDisplayName || "data";
    setCollections((prev) => {
      const collection = prev[targetCollection.id];
      if (!collection) return prev;
      const artifacts = collection.workspaceArtifacts || {};
      const currentArtifact = artifacts[workspaceId] ?? {
        responseJson: null,
        responseFileName: defaultResponseFileName(workspaceName),
        responseContentType: "application/json",
        responseExtension: "json",
        metaJson: null,
        logsTxt: `Workspace ${workspaceName} ready`,
        parserCode: buildParserStub(workspaceName),
        parserGenerated: true,
      };
      return {
        ...prev,
        [targetCollection.id]: {
          ...collection,
          workspaceArtifacts: {
            ...artifacts,
            [workspaceId]: {
              ...currentArtifact,
              dbSourceJson,
              dbCode,
            },
          },
        },
      };
    });
    setActiveCollectionId(targetCollection.id);
    setActiveWorkspaceId(workspaceId);
    setActiveWorkspaceFile("db.py");
    setActivePanelTab("code");
    toast.success("DB code saved as db.py");
  };

  const saveParserHtml = () => {
    if (!parserWorkspaceId) return;
    if (!parserHtmlDraft.trim()) {
      toast.error("HTML cannot be empty.");
      return;
    }
    setManualParserHtmlByWorkspace((prev) => ({
      ...prev,
      [parserWorkspaceId]: parserHtmlDraft,
    }));
    setIsEditingParserHtml(false);
    toast.success("HTML saved");
  };

  const optimizeParserForWorkspace = (workspaceId: string) => {
    if (!workspaceId) return;
    const targetCollection = isParserRoute ? parserCollection : activeCollection;
    const targetNames = targetCollection.id === activeCollection.id ? effectiveNames : resolveEffectiveNames(targetCollection.snippets);
    const workspaceIndex = targetCollection.snippets.findIndex((snippet) => snippet.id === workspaceId);
    const hasManualJsonSource = !!manualParserJsonByWorkspace[workspaceId] || (workspaceId === parserWorkspaceId && !!parserResponseJson);
    if (workspaceIndex === -1 && !hasManualJsonSource) return;
    const workspaceName = workspaceIndex >= 0
      ? targetNames[workspaceIndex] ?? targetCollection.snippets[workspaceIndex].name ?? `request_${workspaceIndex + 1}`
      : parserWorkspaceName || "manual_json";
    const requestKey = isScriptJsonRoute ? activeParserRequestKey : `${targetCollection.id}:${workspaceId}`;
    const currentSelections = parserSelectionsByRequest[requestKey] ?? (isScriptJsonRoute ? [] : targetCollection.workspaceArtifacts?.[workspaceId]?.parserSelections ?? []);
    const selections = optimizeParserSelections(currentSelections);
    if (!isScriptJsonRoute) writeParserSelectionsToArtifact(targetCollection.id, workspaceId, workspaceName, selections);
    setParserSelectionsByRequest((prev) => ({
      ...prev,
      [requestKey]: selections,
    }));
    toast.success("Parser optimized");
  };

  const optimizeHtmlParserForWorkspace = (workspaceId: string) => {
    if (!workspaceId) return;
    const targetCollection = isParserRoute ? parserCollection : activeCollection;
    const targetNames = targetCollection.id === activeCollection.id ? effectiveNames : resolveEffectiveNames(targetCollection.snippets);
    const workspaceIndex = targetCollection.snippets.findIndex((snippet) => snippet.id === workspaceId);
    if (workspaceIndex === -1) return;
    const workspaceName = targetNames[workspaceIndex] ?? targetCollection.snippets[workspaceIndex].name ?? `request_${workspaceIndex + 1}`;
    const requestKey = `${targetCollection.id}:${workspaceId}`;
    const currentSelections = htmlParserSelectionsByRequest[requestKey] ?? targetCollection.workspaceArtifacts?.[workspaceId]?.htmlParserSelections ?? [];
    const selections = optimizeHtmlParserSelections(currentSelections);
    writeHtmlParserSelectionsToArtifact(targetCollection.id, workspaceId, workspaceName, selections);
    setHtmlParserSelectionsByRequest((prev) => ({
      ...prev,
      [requestKey]: selections,
    }));
    toast.success("Parser optimized");
  };

  const optimizeActiveParser = () => {
    optimizeParserForWorkspace(activeWorkspaceId);
  };

  const handleRunActiveWorkspace = async () => {
    if (!activeWorkspaceId || isRunning) return;
    setIsRunning(true);
    try {
      await runWorkspace(activeWorkspaceId);
    } catch (error) {
      const message = extractApiErrorMessage(error);
      setStatusKind("error");
      setStatusMsg(message);
      toast.error(message);
    } finally {
      setIsRunning(false);
    }
  };

  const handleRunParserForWorkspace = async (workspaceId: string) => {
    if (!workspaceId || isRunningParser) return;
    setIsRunningParser(true);
    const initialRunKey = `${(isParserRoute ? parserCollection : activeCollection).id}:${workspaceId}`;
    setParserRunsByRequest((prev) => ({
      ...prev,
      [initialRunKey]: {
        status: "loading",
        output: prev[initialRunKey]?.output ?? null,
        error: null,
        itemCount: prev[initialRunKey]?.itemCount ?? 0,
        updatedAt: Date.now(),
      },
    }));
    try {
      const targetCollection = isParserRoute ? parserCollection : activeCollection;
      const targetNames = targetCollection.id === activeCollection.id ? effectiveNames : resolveEffectiveNames(targetCollection.snippets);
      const workspaceIndex = targetCollection.snippets.findIndex((snippet) => snippet.id === workspaceId);
      const hasManualJsonSource = !!manualParserJsonByWorkspace[workspaceId] || (workspaceId === parserWorkspaceId && !!parserResponseJson);
      if (workspaceIndex === -1 && !hasManualJsonSource) return;
      const workspaceName = workspaceIndex >= 0
        ? targetNames[workspaceIndex] ?? targetCollection.snippets[workspaceIndex].name ?? `request_${workspaceIndex + 1}`
        : parserWorkspaceName || "manual_json";
      const artifact = targetCollection.workspaceArtifacts[workspaceId];
      let responseContent = workspaceId === parserWorkspaceId
        ? (parserBuilderMode === "html" ? parserResponseHtml : parserResponseJson ?? "")
        : artifact?.responseJson ?? "";
      let responseContentType = artifact?.responseContentType ?? "";

      if (!responseContent && targetCollection.id === activeCollection.id) {
        toast.info("No response found. Running request first.");
        const runResult = await runWorkspace(workspaceId);
        if (!runResult?.responseJson) {
          toast.error("No response available for parser");
          return;
        }
        responseContent = runResult.responseJson;
        responseContentType = runResult.responseContentType;
      }

      if (!responseContent) {
        toast.error("No response available for parser");
        return;
      }

      const parserSource = workspaceId === parserWorkspaceId ? parserCode : artifact?.parserCode ?? buildParserStub(workspaceName);
      const parserFunctionName = `${sanitizePythonName(workspaceName || "request")}_parser`;
      const responseType: "html" | "json" = (isParserRoute && workspaceId === parserWorkspaceId)
        ? parserBuilderMode
        : scriptJsonParserByWorkspace[workspaceId] || isHtmlResponse(responseContent, responseContentType) ? "html" : "json";
      const responseContentForParser = responseType === "html" ? normalizeHtmlSource(responseContent) : responseContent;
      const data = await runParserWithBackend({
        response_content: responseContentForParser,
        response_type: responseType,
        parser_code: parserSource,
        parser_function_name: parserFunctionName,
      });

      if (!data.success) {
        const message = data.error || "Parser failed";
        setParserRunsByRequest((prev) => ({
          ...prev,
          [`${targetCollection.id}:${workspaceId}`]: {
            status: "error",
            output: null,
            error: message,
            itemCount: 0,
            updatedAt: Date.now(),
          },
        }));
        if (isParserRoute) setParserPageTab("output");
        toast.error(message);
        return;
      }

      const outputFileName = data.output_file_name || `${parserFunctionName}_output.json`;
      const outputContent = JSON.stringify(data.output ?? null, null, 2);
      const metaJson = JSON.stringify({
        status: 200,
        time_ms: 0,
        size: formatSize(outputContent.length),
        content_type: "application/json",
      }, null, 2);

      setParserRunsByRequest((prev) => ({
        ...prev,
        [`${targetCollection.id}:${workspaceId}`]: {
          status: "success",
          output: data.output ?? null,
          error: null,
          itemCount: getParserOutputItemCount(data.output),
          updatedAt: Date.now(),
        },
      }));

      setCollections((prev) => {
        const collection = prev[targetCollection.id];
        if (!collection) return prev;
        const artifacts = collection.workspaceArtifacts || {};
        const currentArtifact = artifacts[workspaceId] ?? artifact ?? {
          responseJson: null,
          metaJson: null,
          logsTxt: `Workspace ${workspaceName} ready`,
          parserCode: parserSource,
        };
        return {
          ...prev,
          [targetCollection.id]: {
            ...collection,
            workspaceArtifacts: {
              ...artifacts,
              [workspaceId]: {
                ...currentArtifact,
                parserCode: parserSource,
                responseOutputs: {
                  ...currentArtifact.responseOutputs,
                  [outputFileName]: {
                    content: outputContent,
                    contentType: "application/json",
                    extension: "json",
                    metaJson,
                  },
                },
              },
            },
          },
        };
      });
      if (isParserRoute) {
        setParserOutputView("json");
        setParserPageTab("output");
      } else {
        openResponseFile(targetCollection.id, workspaceId, outputFileName, { preserveWorkspaceTabs: true });
      }
      toast.success("Parser ran");
    } catch (error) {
      const message = extractApiErrorMessage(error);
      const targetCollection = isParserRoute ? parserCollection : activeCollection;
      setParserRunsByRequest((prev) => ({
        ...prev,
        [`${targetCollection.id}:${workspaceId}`]: {
          status: "error",
          output: null,
          error: message,
          itemCount: 0,
          updatedAt: Date.now(),
        },
      }));
      if (isParserRoute) setParserPageTab("output");
      toast.error(message);
    } finally {
      setIsRunningParser(false);
    }
  };

  const handleRunActiveParser = async () => {
    await handleRunParserForWorkspace(isParserRoute ? parserWorkspaceId : activeWorkspaceId);
  };

  const openParserPage = (mode?: ParserBuilderMode) => {
    const workspaceId = activeResponseTab?.workspaceId || activeWorkspaceId;
    const nextMode = mode ?? (activeResponseIsHtml && !activeResponseIsJson ? "html" : "json");
    if (!workspaceId) {
      setParserBuilderMode(nextMode);
      setParserPageTab("source");
      navigate("/parser", { state: { parserMode: nextMode } });
      return;
    }

    setParserBuilderMode(nextMode);
    setParserPageTab("source");
    setActiveWorkspaceId(workspaceId);
    setActiveWorkspaceFile("parser.py");
    navigate(`/parser/${encodeURIComponent(activeCollection.id)}/${encodeURIComponent(workspaceId)}`, {
      state: {
        collectionId: activeCollection.id,
        snippetId: workspaceId,
        responseFile: workspaceArtifacts[workspaceId]?.responseFileName,
        parserMode: nextMode,
      },
    });
  };

  const openHtmlParser = () => {
    if (!activeResponseJson || !activeResponseIsHtml) {
      toast.info("Open an HTML response to extract JSON from script tags");
      return;
    }
    setHtmlScriptJsonSources([]);
    setSelectedHtmlScriptJsonId("");
    setHtmlParserOpen(true);
  };

  const scanHtmlScriptJson = () => {
    if (!activeResponseJson) return;
    const sources = extractJsonSourcesFromHtml(normalizeHtmlSource(activeResponseJson));
    setHtmlScriptJsonSources(sources);
    setSelectedHtmlScriptJsonId(sources[0]?.scriptId ?? "");
    if (sources.length === 0) {
      toast.info("No JSON found inside script tags");
    }
  };

  const saveExtractedHtmlScriptJson = () => {
    const source = htmlScriptJsonSources.find((item) => item.scriptId === selectedHtmlScriptJsonId);
    const workspaceId = activeResponseTab?.workspaceId || activeWorkspaceId;
    if (!source || !workspaceId) return;

    const baseName = `${sanitizeName(activeResponseWorkspaceName || activeWorkspaceDisplayName || "request") || "request"}_extracted_json`;
    const sourceIndex = htmlScriptJsonSources.findIndex((item) => item.scriptId === source.scriptId);
    const preferredName = htmlScriptJsonSources.length > 1 ? `${baseName}_${sourceIndex + 1}.json` : `${baseName}.json`;
    const existingOutputs = workspaceArtifacts[workspaceId]?.responseOutputs ?? {};
    let fileName = preferredName;
    let duplicateIndex = 2;
    while (existingOutputs[fileName]) {
      fileName = `${baseName}_${duplicateIndex}.json`;
      duplicateIndex += 1;
    }
    const codeFileName = fileName
      .replace(/_extracted_json(?=_|\.json$)/, "_extract_json")
      .replace(/\.json$/, ".py");
    const metaJson = JSON.stringify({
      status: activeResponseMeta?.status ?? 200,
      time_ms: 0,
      size: formatSize(source.json.length),
      content_type: "application/json",
    }, null, 2);

    updateWorkspaceArtifact(workspaceId, (artifact) => ({
      ...artifact,
      responseOutputs: {
        ...artifact.responseOutputs,
        [fileName]: {
          content: source.json,
          contentType: "application/json",
          extension: "json",
          metaJson,
        },
        [codeFileName]: {
          content: source.standaloneExtractorCode.replace("__OUTPUT_FILE_NAME__", fileName),
          contentType: "text/x-python",
          extension: "py",
        },
      },
    }));
    setManualParserJsonByWorkspace((prev) => ({ ...prev, [workspaceId]: source.json }));
    setScriptJsonParserByWorkspace((prev) => ({ ...prev, [workspaceId]: false }));
    openResponseFile(activeCollection.id, workspaceId, fileName, { preserveWorkspaceTabs: true });
    setParserBuilderMode("json");
    setParserPageTab("source");
    setActiveWorkspaceId(workspaceId);
    setActiveWorkspaceFile(fileName);
    setHtmlParserOpen(false);
    navigate(`/parser/${encodeURIComponent(activeCollection.id)}/${encodeURIComponent(workspaceId)}`, {
      state: {
        collectionId: activeCollection.id,
        snippetId: workspaceId,
        responseFile: fileName,
        parserMode: "json",
      },
    });
    toast.success(`Saved ${fileName}`);
  };

  const handleSubmitIssue = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !accessToken) {
      toast.error("Please login to raise an issue");
      return;
    }
    if (!user.email?.trim()) {
      toast.error("Your account email is missing");
      return;
    }
    if (!issueDescription.trim()) {
      toast.error("Issue description is required");
      return;
    }

    const formData = new FormData();
    formData.append("issue_type", issueType.trim() || "Other");
    formData.append("description", issueDescription.trim());
    issueFiles.forEach((file) => formData.append("files", file));

    try {
      setIsSubmittingIssue(true);
      let token = accessTokenRef.current || accessToken;
      let response;
      try {
        response = await createIssue(formData, token);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) {
          throw error;
        }
        const refreshedToken = await refreshAccessToken();
        if (!refreshedToken) {
          toast.error("Session expired, please login again");
          return;
        }
        token = refreshedToken;
        response = await createIssue(formData, token);
      }
      setSubmittedIssueId(response.issue_id);
      toast.success("Issue submitted");
    } catch (error) {
      toast.error(extractApiErrorMessage(error));
    } finally {
      setIsSubmittingIssue(false);
    }
  };

  const openRaiseIssueDialog = () => {
    if (!user) {
      toast.error("Please login to raise an issue");
      return;
    }
    setSubmittedIssueId("");
    setRaiseIssueOpen(true);
  };

  const handleDownloadAll = async () => {
    const requestFiles = snippets
      .map((snippet, index) => {
        const name = effectiveNames[index] ?? snippet.name ?? `request_${index + 1}`;
        const code = backendOutputs[snippet.id];
        if (!code) return null;
        return {
          filename: `${name}.py`,
          code: repairPythonPipelinePlaceholders(code),
        };
      })
      .filter((file): file is { filename: string; code: string } => !!file);
    const mergedFile = mergeMode && backendMergedOutput
      ? [{ filename: "main.py", code: backendMergedOutput }]
      : [];
    const filesToDownload = [...requestFiles, ...mergedFile];
    if (filesToDownload.length === 0) return;

    const zip = new JSZip();
    for (const file of filesToDownload) zip.file(file.filename, file.code);
    const hasPipeline = filesToDownload.some((file) => scriptUsesPipeline(file.code));
    if (hasPipeline) zip.file("pipeline_utils.py", PIPELINE_UTILS_CODE);
    snippets.forEach((snippet, index) => {
      const name = effectiveNames[index] ?? snippet.name ?? `request_${index + 1}`;
      const parser = workspaceArtifacts[snippet.id]?.parserCode;
      if (parser && parser !== buildParserStub(name)) {
        zip.file(`${name}_parser.py`, parser);
      }
    });
    const blob = await zip.generateAsync({ type: "blob" });
    const zipName = `${sanitizeName(activeCollection.name || activeCollection.id) || "collection"}.zip`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = zipName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatusKind("success");
    setStatusMsg(`Downloaded ${filesToDownload.length} file${filesToDownload.length === 1 ? "" : "s"} as ZIP`);
  };

  const handleFeasibilityCodeArtifacts = useCallback((
    collectionId: string,
    workspaceId: string,
    workspaceName: string,
    artifacts: FeasibilityArtifact[],
    signature: string,
  ) => {
    if (!collectionId || !workspaceId || artifacts.length === 0) return;
    setCollections((prev) => {
      const collection = prev[collectionId];
      if (!collection) return prev;
      const currentArtifact = collection.workspaceArtifacts?.[workspaceId] ?? {
        responseJson: null,
        metaJson: null,
        logsTxt: `Workspace ${workspaceName} ready`,
        parserCode: buildParserStub(workspaceName),
        parserGenerated: true,
      };
      return {
        ...prev,
        [collectionId]: {
          ...collection,
          workspaceArtifacts: {
            ...collection.workspaceArtifacts,
            [workspaceId]: {
              ...currentArtifact,
              feasibilityCodeSignature: signature,
              responseOutputs: {
                ...currentArtifact.responseOutputs,
                ...Object.fromEntries(artifacts.map((file) => [
                  file.filename,
                  {
                    content: file.content,
                    contentType: file.content_type,
                    extension: file.filename.split(".").pop() || "txt",
                  },
                ])),
              },
            },
          },
        },
      };
    });
  }, []);

  const handleGenerateLocalFeasibilityCode = useCallback(async () => {
    if (!activeWorkspaceId || !activeFeasibilityRequest?.url || activeFeasibilityRequest.error) {
      toast.error("Select a valid request before generating feasibility code");
      return;
    }

    const targetCollectionId = activeCollection.id;
    const targetCollectionName = activeCollection.name;
    const targetWorkspaceId = activeWorkspaceId;
    const targetWorkspaceName = activeWorkspaceDisplayName;
    const targetRequestCode = activeWorkspaceRequestCode;
    const targetRequest = activeFeasibilityRequest;
    const targetProxyConfig = proxyConfig;

    const signature = JSON.stringify({
      collectionId: targetCollectionId,
      workspaceId: targetWorkspaceId,
      workspaceName: targetWorkspaceName,
      requestCode: targetRequestCode,
      request: {
        url: targetRequest.url,
        method: targetRequest.method,
        headers: targetRequest.headers,
        body: targetRequest.data ?? null,
      },
    });

    try {
      const { artifacts } = await generateFeasibilityCodeArtifacts({
        collection_name: targetCollectionName,
        workspace_name: targetWorkspaceName,
        request_code: targetRequestCode,
        request: {
          url: targetRequest.url,
          method: targetRequest.method,
          headers: targetRequest.headers,
          body: targetRequest.data,
          timeout_seconds: 10,
          content_marker: null,
        },
        user_proxy: targetProxyConfig,
        test_user_proxy: false,
        production_like: true,
        polite_delay_enabled: true,
        polite_delay_min_ms: 200,
        polite_delay_max_ms: 500,
        normal_request_retries: 2,
        debugging_mode: false,
      });
      handleFeasibilityCodeArtifacts(targetCollectionId, targetWorkspaceId, targetWorkspaceName, artifacts, signature);
      setStatusKind("success");
      setStatusMsg("Feasibility code generated. Run this file locally to test safely.");
      toast.success("Feasibility code generated. Run this file locally to test safely.");
    } catch (error) {
      const message = extractApiErrorMessage(error);
      setStatusKind("error");
      setStatusMsg(message);
      toast.error(`Feasibility code generation failed: ${message}`);
    }
  }, [
    activeCollection.id,
    activeCollection.name,
    activeFeasibilityRequest,
    activeWorkspaceDisplayName,
    activeWorkspaceId,
    activeWorkspaceRequestCode,
    handleFeasibilityCodeArtifacts,
    proxyConfig,
  ]);

  const handleCloseTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setClosedTabIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    if (activeTabId === id) {
      const remaining = visibleTabs.filter((t) => t.id !== id);
      setActiveTabId(remaining[0]?.id ?? "");
    }
  };

  const handleCloseResponseTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenResponseTabs((prev) => {
      const next = prev.filter((tab) => tab.id !== id);
      if (activeResponseTabId === id) {
        const remaining = next.filter((tab) => tab.collectionId === activeCollection.id);
        setActiveResponseTabId(remaining[0]?.id ?? null);
      }
      return next;
    });
  };

  // Session
  const handleSaveSession = () => {
    try {
      const payload = JSON.stringify({
        collections,
        activeCollectionId,
        activeWorkspaceId,
        activeTabId,
        openResponseTabs,
        activeResponseTabId,
        client,
        isAsync,
        mergeMode,
        theme,
        manualParserJsonByWorkspace,
      });
      localStorage.setItem(SESSION_KEY, payload);
      setSavedSession(true);
      setStatusKind("success");
      setStatusMsg("Session saved");
      setTimeout(() => setSavedSession(false), 1400);
    } catch {
      setStatusKind("error");
      setStatusMsg("Could not save session");
    }
  };

  const handleLoadSession = () => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) {
        setStatusKind("info");
        setStatusMsg("No saved session found");
        return;
      }
      const data = JSON.parse(raw);
      if (data.collections && typeof data.collections === "object") {
        const loadedCollections = normalizeCollections(data.collections as Record<string, CollectionState>);
        setCollections(loadedCollections);
        const nextActiveCollectionId = typeof data.activeCollectionId === "string" && loadedCollections[data.activeCollectionId]
          ? data.activeCollectionId
          : Object.keys(loadedCollections)[0] ?? "tmp";
        setActiveCollectionId(nextActiveCollectionId);
        const collection = loadedCollections[nextActiveCollectionId] as CollectionState | undefined;
        const firstSnippet = collection?.snippets?.[0];
        setActiveWorkspaceId(typeof data.activeWorkspaceId === "string" ? data.activeWorkspaceId : firstSnippet?.id ?? "");
        setActiveTabId(typeof data.activeTabId === "string" ? data.activeTabId : firstSnippet ? `req-${firstSnippet.id}` : "");
        setOpenResponseTabs(Array.isArray(data.openResponseTabs) ? data.openResponseTabs : []);
        setActiveResponseTabId(typeof data.activeResponseTabId === "string" ? data.activeResponseTabId : null);
      } else if (Array.isArray(data.snippets)) {
        const migratedSnippets = data.snippets.map((s: Partial<Snippet>, index: number) => normalizeSnippet(s, `request_${index + 1}`));
        setCollections({
          tmp: createCollection("tmp", "tmp", migratedSnippets, true),
        });
        setActiveCollectionId("tmp");
        setActiveWorkspaceId(migratedSnippets[0]?.id ?? "");
        setActiveTabId(migratedSnippets[0] ? `req-${migratedSnippets[0].id}` : "");
      }
      if (data.client === "httpx" || data.client === "requests") setClient(data.client);
      if (typeof data.isAsync === "boolean") setIsAsync(data.isAsync);
      if (typeof data.mergeMode === "boolean") setMergeMode(data.mergeMode);
      if (data.theme === "light" || data.theme === "dark") setTheme(data.theme);
      if (data.manualParserJsonByWorkspace && typeof data.manualParserJsonByWorkspace === "object") {
        setManualParserJsonByWorkspace(data.manualParserJsonByWorkspace as Record<string, string>);
      }
      setClosedTabIds(new Set());
      setStatusKind("success");
      setStatusMsg("Session loaded");
    } catch {
      setStatusKind("error");
      setStatusMsg("Could not load session");
    }
  };

  const handleLogout = () => {
    logout();
    const fallback = createCollection("tmp", "tmp", SAMPLE_SNIPPETS, true);
    setCollections({ tmp: fallback });
    setActiveCollectionId("tmp");
    setActiveWorkspaceId("");
    setActiveWorkspaceFile("request.py");
    setActiveTabId("");
    setClosedTabIds(new Set());
    setOpenResponseTabs([]);
    setActiveResponseTabId(null);
    setExpandedWorkspaceIds(new Set());
    setHasLoadedRemoteWorkspace(false);
    setStatusKind("info");
    setStatusMsg("Signed out");
    toast.success("Signed out");
  };

  async function handleSyncBackend(options: { silent?: boolean; force?: boolean } = {}) {
    const silent = options.silent ?? false;
    const force = options.force ?? false;
    const currentSyncKey = syncKey;

    if (!force) {
      if (inFlightSyncKeyRef.current === currentSyncKey) return;
      if (lastSuccessfulSyncKeyRef.current === currentSyncKey) return;
    }

    const conversionTargets = blocks
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => block.raw.trim().length > 0);
    const changedConversionTargets = force
      ? conversionTargets
      : conversionTargets.filter(({ block }) => lastSyncedSnippetHashesRef.current[block.id] !== snippetSyncHashes[block.id]);

    if (conversionTargets.length === 0) {
      setStatusKind("error");
      setStatusMsg("Add a curl command before syncing");
      if (!silent) {
        toast.error("Add a curl command before syncing");
      }
      return;
    }

    if (changedConversionTargets.length === 0 && !mergeMode) {
      lastSuccessfulSyncKeyRef.current = currentSyncKey;
      return;
    }

    if (!validateProxyConfig(silent)) {
      return;
    }

    inFlightSyncKeyRef.current = currentSyncKey;

    try {
      setIsSyncingBackend(true);
      const convertedTargets = conversionTargets.map(({ block, index }) => {
        const converted = convertCurlLocally(block.raw);
        return {
          block,
          index,
          converted,
          functionName: effectiveNames[index],
        };
      });

      const changedIds = new Set(changedConversionTargets.map(({ block }) => block.id));
      const singleResults = convertedTargets
        .filter(({ block }) => force || changedIds.has(block.id))
        .map(({ block, index, converted, functionName }) => {
          const tabId = `req-${block.id}`;
          const existingCode = backendOutputs[block.id];
          const preserveEditedCode = !!dirtyCodeTabs[tabId] && !!existingCode && generatedCodeMatchesRequestName(existingCode, functionName);
          return {
            id: block.id,
            code: preserveEditedCode ? repairPythonPipelinePlaceholders(existingCode) : repairPythonPipelinePlaceholders(enhanceCurlConverterPython(converted.pythonCode, {
              functionName,
              request: converted.request,
              proxy: proxyConfig,
              contextRequests: convertedTargets.map(({ converted: contextConverted, functionName: contextFunctionName }) => ({
                functionName: contextFunctionName,
                request: contextConverted.request,
              })),
            })),
            functionName,
            hash: snippetSyncHashes[block.id],
            preserveEditedCode,
          };
        });

      const nextOutputs: Record<string, string> = {};
      singleResults.forEach((entry) => {
        nextOutputs[entry.id] = entry.code || "# Frontend conversion returned no code\n";
        lastSyncedSnippetHashesRef.current[entry.id] = entry.hash;
      });
      setBackendOutputs((prev) => ({ ...prev, ...nextOutputs }));
      setDirtyCodeTabs((prev) => {
        const next = { ...prev };
        singleResults.forEach((entry) => {
          if (!entry.preserveEditedCode) delete next[`req-${entry.id}`];
        });
        return next;
      });

      if (mergeMode) {
        const currentOutputs = { ...backendOutputs, ...nextOutputs };
        const batchEntries = convertedTargets.map(({ block, converted, functionName }) => ({
          functionName,
          request: converted.request,
          code: currentOutputs[block.id],
        }));
        const parserFunctionNames = convertedTargets
          .filter(({ block, functionName }) => {
            const parser = workspaceArtifacts[block.id]?.parserCode;
            return !!parser && parser !== buildParserStub(functionName);
          })
          .map(({ functionName }) => `${functionName}_parser`);
        setBackendMergedOutput(buildMergedScript({ requests: batchEntries, parserFunctionNames }));
        setBackendParserOutput(buildParserStubs(batchEntries.map((entry) => entry.functionName)));
        setDirtyCodeTabs((prev) => {
          const next = { ...prev };
          delete next.merged;
          return next;
        });
      } else {
        setBackendMergedOutput(null);
        setBackendParserOutput(null);
      }

      const label = `${singleResults.length} changed snippet${singleResults.length === 1 ? "" : "s"}`;
      lastSuccessfulSyncKeyRef.current = currentSyncKey;
      setStatusKind("success");
      setStatusMsg(`Converted locally - ${label}`);
      if (!silent) {
        toast.success("Converted curl locally");
      }
    } catch (error) {
      const message = error instanceof CurlConverterError
        ? error.message
        : "Unable to convert this cURL. Please check the cURL syntax.";
      setStatusKind("error");
      setStatusMsg(message);
      if (!silent) toast.error(message);
    } finally {
      if (inFlightSyncKeyRef.current === currentSyncKey) {
        inFlightSyncKeyRef.current = null;
      }
      setIsSyncingBackend(false);
    }
  }

  useEffect(() => {
    const hasRenderableSnippet = snippets.some((snippet) => snippet.raw.trim().length > 0);
    if (!hasRenderableSnippet) {
      return;
    }

    const timer = window.setTimeout(() => {
      void handleSyncBackend({ silent: true });
    }, 650);

    return () => window.clearTimeout(timer);
  }, [syncKey, snippets]);

  if (isParserRoute) {
    const canUseParser = !!parserWorkspaceId;
    const hasResponse = !!parserResponseJson;
    const hasHtml = !!parserResponseHtml;
    const canShowJsonParser = hasResponse && parserResponseIsJson;
    const parserJsonEditorVisible = parserBuilderMode === "json" && parserPageTab === "source" && isEditingParserJson;
    const parserHtmlEditorVisible = parserBuilderMode === "html" && parserPageTab === "source" && isEditingParserHtml;
    const parserTabs: ParserPageTab[] = ["source", "paths", "parser", "output", "jsonSource", "dbCode"];
    const currentLoop = parserBuilderMode === "html" ? currentHtmlLoop : currentJsonLoop;
    const canShowTableOutput = getParserOutputTableRows(activeParserRun?.output).length > 0;

    return (
      <div className="flex h-screen flex-col bg-background text-foreground">
        <header className="flex h-12 items-center justify-between border-b border-border bg-surface/70 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => {
                setActiveWorkspaceFile("request.py");
                setActivePanelTab("code");
                navigate("/");
              }}
              className={quietToolbarButtonClass}
            >
              Back to workspace
            </button>
            <div className="min-w-0 font-mono text-[12px]">
              <span className="font-semibold text-syntax-function">PARSER · {isScriptJsonRoute ? "SCRIPT JSON" : parserBuilderMode.toUpperCase()}</span>
              <span className="px-2 text-syntax-comment">|</span>
              <span className="truncate text-muted-foreground">{parserWorkspaceName}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selectedParserPath && (
              <span className="hidden max-w-[320px] truncate font-mono text-[11px] text-muted-foreground md:inline" title={`${selectedParserPath} (${typeof selectedParserValue})`}>
                {selectedParserPath} {"->"} {selectedParserOutputKey || "value"}
              </span>
            )}
            {parserBuilderMode === "json" && parserPageTab === "source" && (
              <>
                <button
                  onClick={() => void copyText(parserJsonEditorVisible ? parserJsonDraft : parserResponseJson ?? parserJsonDraft, "Copied JSON")}
                  disabled={!canUseParser || (!parserResponseJson && !parserJsonDraft)}
                  className={quietToolbarButtonClass}
                >
                  <Copy className="h-3 w-3" strokeWidth={2} />
                  Copy JSON
                </button>
                {!parserJsonEditorVisible && (
                  <button
                    onClick={() => setQuickAddMode(!quickAddMode)}
                    disabled={!canUseParser}
                    title={quickAddMode ? "Click to return to normal node selection mode" : "Click any JSON field to automatically add it to parser paths"}
                    className={quickAddMode ? primaryToolbarButtonClass : quietToolbarButtonClass}
                  >
                    {quickAddMode ? "Add Mode Active" : "Enable Add Mode"}
                  </button>
                )}
                {parserJsonEditorVisible ? (
                  <button
                    onClick={saveParserJson}
                    disabled={!parserJsonDraft.trim() || (isScriptJsonRoute && !activeScriptJsonSource)}
                    className={primaryToolbarButtonClass}
                  >
                    Save JSON
                  </button>
                ) : (
                  <button
                    onClick={() => setIsEditingParserJson(true)}
                    disabled={!canUseParser || (isScriptJsonRoute && !activeScriptJsonSource)}
                    className={quietToolbarButtonClass}
                  >
                    Edit JSON
                  </button>
                )}
              </>
            )}
            {parserBuilderMode === "html" && parserPageTab === "source" && (
              <>
                <button
                  onClick={() => void copyText(parserHtmlEditorVisible ? parserHtmlDraft : parserResponseHtml || parserHtmlDraft, "Copied HTML")}
                  disabled={!canUseParser || (!parserResponseHtml && !parserHtmlDraft)}
                  className={quietToolbarButtonClass}
                >
                  <Copy className="h-3 w-3" strokeWidth={2} />
                  Copy HTML
                </button>
                {parserHtmlEditorVisible ? (
                  <button
                    onClick={saveParserHtml}
                    disabled={!canUseParser}
                    className={primaryToolbarButtonClass}
                  >
                    Save HTML
                  </button>
                ) : (
                  <button
                    onClick={() => setIsEditingParserHtml(true)}
                    disabled={!canUseParser}
                    className={quietToolbarButtonClass}
                  >
                    Edit HTML
                  </button>
                )}
              </>
            )}
            {parserPageTab === "jsonSource" && (
              <>
                <button
                  onClick={() => void copyText(visibleDbJsonSource, "Copied JSON")}
                  disabled={!visibleDbJsonSource}
                  className={quietToolbarButtonClass}
                >
                  <Copy className="h-3 w-3" strokeWidth={2} />
                  Copy JSON
                </button>
                {isEditingDbJson ? (
                  <button
                    onClick={saveDbJsonSource}
                    className={primaryToolbarButtonClass}
                  >
                    Save JSON
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setDbJsonDraft(dbJsonSourceContent);
                      setIsEditingDbJson(true);
                    }}
                    className={quietToolbarButtonClass}
                  >
                    Edit JSON
                  </button>
                )}
              </>
            )}
            {parserPageTab === "parser" && (
              <>
                <button
                  onClick={() => void handleRunActiveParser()}
                  disabled={!canUseParser || isRunningParser}
                  className={primaryToolbarButtonClass}
                >
                  {isRunningParser ? <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} /> : <Play className="h-3 w-3" strokeWidth={2} />}
                  {isRunningParser ? "Running..." : "Run Parser"}
                </button>
                <button
                  onClick={() => parserWorkspaceId && (parserBuilderMode === "html" ? optimizeHtmlParserForWorkspace(parserWorkspaceId) : optimizeParserForWorkspace(parserWorkspaceId))}
                  disabled={!canUseParser}
                  className={quietToolbarButtonClass}
                  title={parserBuilderMode === "html" ? "Merge and clean HTML selectors" : "Rebuild parser from selected JSON paths"}
                >
                  Optimize Parser
                </button>
                <button
                  onClick={() => void copyText(parserCode, "Copied parser")}
                  disabled={!canUseParser}
                  className={quietToolbarButtonClass}
                >
                  <Copy className="h-3 w-3" strokeWidth={2} />
                  Copy Parser
                </button>
                {isScriptJsonRoute && activeScriptJsonSource?.extractorCode && (
                  <button
                    onClick={() => void copyText(activeScriptJsonSource.extractorCode, "Copied extractor")}
                    className={quietToolbarButtonClass}
                  >
                    <Copy className="h-3 w-3" strokeWidth={2} />
                    Copy Extractor
                  </button>
                )}
                <button
                  onClick={() => downloadFile("parser.py", parserCode)}
                  disabled={!canUseParser}
                  className={quietToolbarButtonClass}
                >
                  <Download className="h-3 w-3" strokeWidth={2} />
                  Download Parser
                </button>
              </>
            )}
            {parserPageTab === "output" && (
              <>
                <button
                  onClick={() => void copyText(activeParserRun?.error || parserOutputContent, "Copied output")}
                  disabled={!activeParserRun || activeParserRun.status === "loading" || (!parserOutputContent && !activeParserRun.error)}
                  className={quietToolbarButtonClass}
                >
                  <Copy className="h-3 w-3" strokeWidth={2} />
                  Copy Output
                </button>
                <button
                  onClick={() => downloadFile("parser_output.json", parserOutputContent || JSON.stringify({ error: activeParserRun?.error }, null, 2))}
                  disabled={!activeParserRun || activeParserRun.status === "loading" || (!parserOutputContent && !activeParserRun.error)}
                  className={quietToolbarButtonClass}
                >
                  <Download className="h-3 w-3" strokeWidth={2} />
                  Download Output
                </button>
                <button
                  onClick={() => {
                    if (!activeParserRequestKey) return;
                    setParserRunsByRequest((prev) => {
                      const next = { ...prev };
                      delete next[activeParserRequestKey];
                      return next;
                    });
                  }}
                  disabled={!activeParserRun}
                  className={quietToolbarButtonClass}
                >
                  Clear Output
                </button>
              </>
            )}
            {parserPageTab === "dbCode" && (
              <>
                <button
                  onClick={() => void copyText(dbCode, "Copied DB code")}
                  disabled={!dbCode || !!dbGeneration.error}
                  className={quietToolbarButtonClass}
                >
                  <Copy className="h-3 w-3" strokeWidth={2} />
                  Copy DB Code
                </button>
                <button
                  onClick={saveDbCodeForWorkspace}
                  disabled={!dbCode || !!dbGeneration.error}
                  className={quietToolbarButtonClass}
                >
                  <Save className="h-3 w-3" strokeWidth={2} />
                  Save DB Code
                </button>
              </>
            )}
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-border bg-surface">
            <div className="flex min-w-0 flex-1 items-center gap-0 overflow-x-auto scrollbar-thin">
              {parserTabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setParserPageTab(tab)}
                  className={cn(
                    panelTabClass,
                    parserPageTab === tab
                      ? "bg-background text-foreground before:absolute before:inset-x-2 before:top-0 before:h-px before:bg-primary"
                      : "text-muted-foreground hover:bg-surface-elevated/80 hover:text-foreground"
                  )}
                >
                  {tab === "jsonSource" ? "JSON Source" : tab === "dbCode" ? "DB Code" : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <ParserInspectorErrorBoundary resetKey={`${parserWorkspaceId}:${parserBuilderMode}:${parserPageTab}:${parserResponseHtml.length}:${parserResponseJson?.length ?? 0}`}>
          {parserBuilderMode === "json" && parserPageTab === "source" ? (
            <div className="relative min-h-0 flex-1 overflow-auto">
              {isScriptJsonRoute && !activeScriptJsonSource ? (
                <div className="flex h-full min-h-[220px] items-center justify-center px-4 py-8 font-mono">
                  {scriptJsonLoadAttempted ? (
                    <div className="rounded-sm border border-destructive/40 bg-destructive/5 px-4 py-3 text-[12px] text-destructive">
                      Script JSON data not found. Reopen from HTML parser.
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-sm border border-border bg-surface/35 px-4 py-3 text-[12px] text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" strokeWidth={2} />
                      Loading script JSON...
                    </div>
                  )}
                </div>
              ) : parserJsonEditorVisible ? (
                <textarea
                  value={parserJsonDraft}
                  onChange={(event) => setParserJsonDraft(event.target.value)}
                  onPaste={() => setIsEditingParserJson(true)}
                  spellCheck={false}
                  placeholder={isScriptJsonRoute ? "" : "{\n  \"id\": 1,\n  \"items\": []\n}"}
                  className="block h-full min-h-full w-full resize-none bg-background px-4 py-3 font-mono text-[12px] leading-[1.6] text-foreground caret-primary outline-none placeholder:text-muted-foreground/50"
                />
              ) : !hasResponse ? (
                <textarea
                  value={parserJsonDraft}
                  onChange={(event) => {
                    setParserJsonDraft(event.target.value);
                    setIsEditingParserJson(true);
                  }}
                  onPaste={() => setIsEditingParserJson(true)}
                  spellCheck={false}
                  placeholder={"{\n  \"id\": 1,\n  \"items\": []\n}"}
                  className="block h-full min-h-full w-full resize-none bg-background px-4 py-3 font-mono text-[12px] leading-[1.6] text-foreground caret-primary outline-none placeholder:text-muted-foreground/50"
                />
              ) : canShowJsonParser ? (
                <ResponseBodyViewer
                  source={parserResponseJson}
                  selectedPath={selectedParserPath}
                  addedPaths={addedParserPaths}
                  onAddToParser={addSelectedPathToParser}
                  onRemoveFromParser={removePathFromParser}
                  onSelectedPathChange={handleParserPathSelect}
                  quickAddMode={quickAddMode}
                />
              ) : (
                <div className="px-4 py-3 text-[11px] text-muted-foreground">JSON parser builder works only for JSON responses.</div>
              )}
            </div>
          ) : parserBuilderMode === "json" && parserPageTab === "paths" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center justify-between gap-3 border-b border-border bg-background px-4 py-1.5">
                <div className="min-w-0 font-mono text-[11px] text-muted-foreground">
                  <span>{parserSelections.length} path{parserSelections.length === 1 ? "" : "s"} selected</span>
                  <span className="px-2 text-syntax-comment">|</span>
                  <span>{parserLoopCount} loop{parserLoopCount === 1 ? "" : "s"} detected</span>
                  {currentLoop && (
                    <>
                      <span className="px-2 text-syntax-comment">|</span>
                      <span className="truncate">Loop source: {currentLoop}</span>
                    </>
                  )}
                </div>
                <button
                  onClick={addManualParserPath}
                  disabled={!canUseParser}
                  className={quietToolbarButtonClass}
                >
                  <Plus className="h-3 w-3" strokeWidth={2} />
                  Add Path
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
                {parserSelections.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground">No paths selected</div>
                ) : (
                  <div className="space-y-2">
                    {parserSelections.map((selection, index) => {
                      const warning = getParserPathExistenceWarning(selection.path, parserResponseJson);
                      const loopParentPath = getJsonLoopParentPath(selection.path);
                      return (
                        <div key={`${selection.path}-${index}`} className="grid gap-1 md:grid-cols-[minmax(0,1fr)_220px_96px_28px] md:items-start">
                          <div className="min-w-0">
                            <input
                              value={selection.path}
                              onChange={(event) => updateParserSelectionRow(index, { path: event.target.value })}
                              className="h-8 w-full rounded-sm border border-border bg-background px-2 font-mono text-[12px] text-foreground outline-none transition-colors focus:border-border-strong"
                            />
                            {warning && <div className="mt-1 text-[10px] text-destructive">{warning}</div>}
                          </div>
                          <input
                            value={selection.outputKey}
                            onChange={(event) => updateParserSelectionRow(index, { outputKey: event.target.value })}
                            className="h-8 w-full rounded-sm border border-border bg-background px-2 font-mono text-[12px] text-foreground outline-none transition-colors focus:border-border-strong"
                            placeholder="output field"
                          />
                          {(() => {
                            const candidates = getJsonLoopCandidatesFromParts(normalizeSelectionParts(selection.path));
                            if (candidates.length === 0) {
                              return (
                                <button
                                  disabled
                                  className="h-8 rounded-sm border border-border bg-background px-2 font-mono text-[12px] text-muted-foreground w-full text-left"
                                >
                                  single
                                </button>
                              );
                            }

                            const explicitLoopPaths = selection.loopPaths ?? [];
                            const selectedCount = selection.selectionMode === "loop" ? (explicitLoopPaths.length > 0 ? explicitLoopPaths.length : 1) : 0;
                            const dropdownOpen = openLoopDropdownIndex === index;

                            return (
                              <div className="relative w-full">
                                <button
                                  onClick={() => setOpenLoopDropdownIndex(dropdownOpen ? null : index)}
                                  className="h-8 rounded-sm border border-border bg-background px-2 font-mono text-[12px] text-foreground outline-none transition-colors focus:border-border-strong w-full text-left flex items-center justify-between"
                                >
                                  <span className="truncate">
                                    {selectedCount === 0 ? "single" : `${selectedCount} loop${selectedCount > 1 ? "s" : ""}`}
                                  </span>
                                  <span className="text-[8px] text-muted-foreground ml-1">▼</span>
                                </button>

                                {dropdownOpen && (
                                  <>
                                    <div 
                                      className="fixed inset-0 z-40" 
                                      onClick={() => setOpenLoopDropdownIndex(null)}
                                    />
                                    <div className="absolute right-0 top-9 z-50 min-w-[280px] max-w-[320px] rounded-md border border-border bg-popover p-2 shadow-md animate-in fade-in-50 slide-in-from-top-1 text-popover-foreground">
                                      <div className="text-[10px] font-semibold text-muted-foreground px-2 py-1 border-b border-border mb-1.5 flex justify-between items-center">
                                        <span>SELECT LOOPS</span>
                                        {selectedCount > 0 && (
                                          <button 
                                            onClick={() => {
                                              updateParserSelectionRow(index, { selectionMode: "single", loopPaths: [] });
                                              setOpenLoopDropdownIndex(null);
                                            }}
                                            className="text-[9px] text-destructive hover:underline"
                                          >
                                            Clear all
                                          </button>
                                        )}
                                      </div>
                                      <div className="space-y-1 max-h-[200px] overflow-y-auto">
                                        {candidates.map((candidate, idx) => {
                                          const isChecked = selection.selectionMode === "loop" && (
                                            explicitLoopPaths.includes(candidate.displayPath) || 
                                            (explicitLoopPaths.length === 0 && idx === 0)
                                          );

                                          return (
                                            <label 
                                              key={candidate.displayPath} 
                                              className="flex items-start gap-2.5 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground cursor-pointer text-left select-none"
                                            >
                                              <input
                                                type="checkbox"
                                                checked={isChecked}
                                                onChange={(event) => {
                                                  const checked = event.target.checked;
                                                  let nextPaths = [...explicitLoopPaths];
                                                  if (explicitLoopPaths.length === 0 && selection.selectionMode === "loop") {
                                                    nextPaths = [candidates[0].displayPath];
                                                  }
                                                  if (checked) {
                                                    if (!nextPaths.includes(candidate.displayPath)) {
                                                      nextPaths.push(candidate.displayPath);
                                                    }
                                                  } else {
                                                    nextPaths = nextPaths.filter(p => p !== candidate.displayPath);
                                                  }
                                                  nextPaths = candidates
                                                    .filter(c => nextPaths.includes(c.displayPath))
                                                    .map(c => c.displayPath);
                                                  const nextMode = nextPaths.length > 0 ? "loop" : "single";
                                                  updateParserSelectionRow(index, { 
                                                    selectionMode: nextMode, 
                                                    loopPaths: nextPaths 
                                                  });
                                                }}
                                                className="mt-0.5 rounded border-border bg-background text-primary focus:ring-ring focus:ring-offset-background h-3.5 w-3.5"
                                              />
                                              <div className="min-w-0 flex-1">
                                                <div className="text-[11px] font-medium leading-none text-foreground truncate" title={candidate.displayPath}>
                                                  {candidate.label}
                                                </div>
                                                <div className="text-[9px] text-muted-foreground font-mono mt-0.5 truncate" title={candidate.displayPath}>
                                                  {candidate.displayPath}
                                                </div>
                                              </div>
                                            </label>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })()}
                          <button
                            onClick={() => deleteParserSelectionRow(index)}
                            className="flex h-8 w-8 items-center justify-center rounded-sm border border-border bg-transparent text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                            aria-label={`Delete ${selection.path}`}
                          >
                            <Trash2 className="h-3 w-3" strokeWidth={2} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : parserBuilderMode === "html" && parserPageTab === "source" ? (
            <div className="relative min-h-0 flex-1 overflow-auto">
              {parserHtmlEditorVisible || !hasHtml ? (
                <textarea
                  value={parserHtmlDraft}
                  onChange={(event) => {
                    setParserHtmlDraft(event.target.value);
                    setIsEditingParserHtml(true);
                  }}
                  onPaste={() => setIsEditingParserHtml(true)}
                  spellCheck={false}
                  placeholder={"<html>\n  <body></body>\n</html>"}
                  className="block h-full min-h-full w-full resize-none bg-background px-4 py-3 font-mono text-[12px] leading-[1.6] text-foreground caret-primary outline-none placeholder:text-muted-foreground/50"
                />
              ) : (
                <HtmlResponseViewer
                  html={parserResponseHtml}
                  addedPaths={addedHtmlPaths}
                  onAddToParser={addHtmlPathToParser}
                  onRemoveFromParser={removeHtmlPathFromParser}
                  onOpenScriptJson={(source) => {
                    if (!parserWorkspaceId) return;
                    const key = `${parserCollection.id}:${parserWorkspaceId}:script-json:${source.scriptId}`;
                    setScriptJsonSourcesByRequest((prev) => ({ ...prev, [key]: source }));
                    setParserSelectionsByRequest((prev) => ({ ...prev, [key]: prev[key] ?? [] }));
                    try {
                      const storageKey = scriptJsonStorageKey(key);
                      const payload = JSON.stringify(source);
                      window.sessionStorage.setItem(storageKey, payload);
                      window.localStorage.setItem(storageKey, payload);
                    } catch {
                      toast.error("Could not cache script JSON for new tab");
                    }
                    const scriptJsonUrl = `${window.location.origin}/parser/${encodeURIComponent(parserCollection.id)}/${encodeURIComponent(parserWorkspaceId)}/script-json/${encodeURIComponent(source.scriptId)}`;
                    window.open(scriptJsonUrl, "_blank", "noopener,noreferrer");
                    toast.success("Script JSON opened");
                  }}
                />
              )}
            </div>
          ) : parserBuilderMode === "html" && parserPageTab === "paths" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center justify-between gap-3 border-b border-border bg-background px-4 py-1.5">
                <div className="min-w-0 font-mono text-[11px] text-muted-foreground">
                  <span>{htmlParserSelections.length} path{htmlParserSelections.length === 1 ? "" : "s"} selected</span>
                  <span className="px-2 text-syntax-comment">|</span>
                  <span>{parserLoopCount} loop{parserLoopCount === 1 ? "" : "s"} detected</span>
                  {currentLoop && (
                    <>
                      <span className="px-2 text-syntax-comment">|</span>
                      <span className="truncate">Loop source: {currentLoop}</span>
                    </>
                  )}
                </div>
                <button
                  onClick={addManualHtmlPath}
                  disabled={!canUseParser}
                  className={quietToolbarButtonClass}
                >
                  <Plus className="h-3 w-3" strokeWidth={2} />
                  Add Path
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
                {htmlParserSelections.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground">No paths selected</div>
                ) : (
                  <div className="space-y-2">
                    {htmlParserSelections.map((selection, index) => {
                      const duplicateIndexes = getDuplicateHtmlSelectorIndexes(htmlParserSelections);
                      const isDuplicate = duplicateIndexes.has(index);
                      return (
                        <div key={`${selection.selector || selection.path}-${index}`} className="space-y-1">
                          <div className="grid gap-1 md:grid-cols-[96px_minmax(0,1fr)_180px_120px_150px_28px] md:items-start">
                            <select
                              value={selection.selectorType ?? "xpath"}
                              onChange={(event) => updateHtmlParserSelectionRow(index, { selectorType: event.target.value as "xpath" | "css" })}
                              className="h-8 rounded-sm border border-border bg-background px-2 font-mono text-[12px] text-foreground outline-none transition-colors focus:border-border-strong"
                            >
                              <option value="xpath">xpath</option>
                              <option value="css">css</option>
                            </select>
                            <input
                              value={selection.selector || selection.path}
                              onChange={(event) => updateHtmlParserSelectionRow(index, { selector: event.target.value, path: event.target.value })}
                              className={cn(
                                "h-8 w-full rounded-sm border bg-background px-2 font-mono text-[12px] text-foreground outline-none transition-colors focus:border-border-strong",
                                isDuplicate ? "border-destructive/70" : "border-border"
                              )}
                              placeholder="selector"
                            />
                            <input
                              value={selection.outputKey}
                              onChange={(event) => updateHtmlParserSelectionRow(index, { outputKey: event.target.value })}
                              className="h-8 w-full rounded-sm border border-border bg-background px-2 font-mono text-[12px] text-foreground outline-none transition-colors focus:border-border-strong"
                              placeholder="output field"
                            />
                            <select
                              value={selection.extractMode ?? selection.valueMode ?? "text"}
                              onChange={(event) => updateHtmlParserSelectionRow(index, { extractMode: event.target.value as "text" | "attr" | "html" })}
                              className="h-8 rounded-sm border border-border bg-background px-2 font-mono text-[12px] text-foreground outline-none transition-colors focus:border-border-strong"
                            >
                              <option value="text">text</option>
                              <option value="attr">attr</option>
                              <option value="html">html</option>
                            </select>
                            <input
                              value={selection.attrName ?? ""}
                              onChange={(event) => updateHtmlParserSelectionRow(index, { attrName: event.target.value })}
                              disabled={(selection.extractMode ?? selection.valueMode ?? "text") !== "attr"}
                              className="h-8 w-full rounded-sm border border-border bg-background px-2 font-mono text-[12px] text-foreground outline-none transition-colors focus:border-border-strong disabled:cursor-not-allowed disabled:opacity-40"
                              placeholder="attr name"
                            />
                            <button
                              onClick={() => deleteHtmlParserSelectionRow(index)}
                              className="flex h-8 w-8 items-center justify-center rounded-sm border border-border bg-transparent text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                              aria-label={`Delete ${selection.selector || selection.path}`}
                            >
                              <Trash2 className="h-3 w-3" strokeWidth={2} />
                            </button>
                          </div>
                          {isDuplicate && <div className="font-mono text-[10px] text-destructive">Duplicate selector mapping</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : parserPageTab === "parser" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {isScriptJsonRoute && activeScriptJsonSource?.extractorCode && (
                <div className="flex items-center gap-0 border-b border-border bg-surface">
                  {(["parser", "extractor"] as const).map((file) => (
                    <button
                      key={file}
                      onClick={() => setParserCodeFile(file)}
                      className={cn(
                        fileTabClass,
                        parserCodeFile === file
                          ? "bg-background text-foreground before:absolute before:inset-x-2 before:top-0 before:h-px before:bg-primary"
                          : "text-muted-foreground hover:bg-surface-elevated/80 hover:text-foreground"
                      )}
                    >
                      <FileCode className="h-3 w-3" strokeWidth={2} />
                      <span>{file === "parser" ? "parser.py" : "script_json_extractor.py"}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="relative min-h-0 flex-1 overflow-auto">
                {parserCode === buildParserStub(parserWorkspaceName) && parserCodeFile === "parser" ? (
                  <EmptyState title="No parser output yet" detail="Select JSON paths or HTML elements to generate parser code." />
                ) : (
                  <pre className="px-4 py-3">
                    <HighlightedPython code={isScriptJsonRoute && parserCodeFile === "extractor" ? activeScriptJsonSource?.extractorCode ?? "" : parserCode} />
                  </pre>
                )}
              </div>
            </div>
          ) : parserPageTab === "output" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center justify-between border-b border-border bg-background px-4 py-1.5 font-mono text-[11px]">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={cn(
                    "font-semibold",
                    activeParserRun?.status === "success" && "text-success",
                    activeParserRun?.status === "error" && "text-destructive",
                    (!activeParserRun || activeParserRun.status === "idle" || activeParserRun.status === "loading") && "text-muted-foreground"
                  )}>
                    {activeParserRun?.status === "success" ? "success" : activeParserRun?.status === "error" ? "error" : activeParserRun?.status === "loading" ? "running" : "idle"}
                  </span>
                  <span className="text-syntax-comment">|</span>
                  <span className="text-muted-foreground">{getParserOutputSummary(activeParserRun?.output)}</span>
                </div>
                {canShowTableOutput && (
                  <div className="flex items-center gap-1">
                    {(["json", "table"] as ParserOutputView[]).map((view) => (
                      <button
                        key={view}
                        onClick={() => setParserOutputView(view)}
                        className={cn(
                          "h-6 rounded-sm border px-2 text-[10px] transition-colors",
                          parserOutputView === view
                            ? "border-primary/60 bg-primary/10 text-primary"
                            : "border-border bg-background/40 text-muted-foreground hover:border-border-strong hover:text-foreground"
                        )}
                      >
                        {view === "json" ? "JSON View" : "Table View"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative min-h-0 flex-1 overflow-auto">
                {activeParserRun?.status === "loading" ? (
                  <EmptyState title="Parser running" detail="Output will appear here when the run finishes." />
                ) : activeParserRun?.status === "error" ? (
                  <div className="m-4 rounded-sm border border-destructive/40 bg-destructive/5 px-4 py-3 font-mono text-[12px] text-destructive">
                    {activeParserRun.error || "Parser failed"}
                  </div>
                ) : activeParserRun?.status === "success" && parserOutputView === "table" && canShowTableOutput ? (
                  <ParserOutputTable value={activeParserRun.output} />
                ) : activeParserRun?.status === "success" ? (
                  <pre className="px-4 py-3 font-mono text-[12px] leading-[1.6] text-foreground">{parserOutputContent}</pre>
                ) : (
                  <EmptyState title="No parser output yet" detail="Run Parser from the Parser tab to see results here." />
                )}
              </div>
            </div>
          ) : parserPageTab === "jsonSource" ? (
            <div className="relative min-h-0 flex-1 overflow-auto">
              {isEditingDbJson ? (
                <textarea
                  value={dbJsonDraft}
                  onChange={(event) => setDbJsonDraft(event.target.value)}
                  spellCheck={false}
                  placeholder={"{\n  \"id\": 1,\n  \"items\": []\n}"}
                  className="block h-full min-h-full w-full resize-none bg-background px-4 py-3 font-mono text-[12px] leading-[1.6] text-foreground caret-primary outline-none placeholder:text-muted-foreground/50"
                />
              ) : dbSourceJson ? (
                <pre className="px-4 py-3 font-mono text-[12px] leading-[1.6] text-foreground">{dbSourceJson}</pre>
              ) : (
                <EmptyState title="No JSON source yet" detail="Run Parser or save JSON source to generate DB code." />
              )}
            </div>
          ) : (
            <div className="relative min-h-0 flex-1 overflow-auto">
              {dbGeneration.error ? (
                <div className="m-4 rounded-sm border border-destructive/40 bg-destructive/5 px-4 py-3 font-mono text-[12px] text-destructive">
                  {dbGeneration.error}
                </div>
              ) : dbCode ? (
                <pre className="px-4 py-3">
                  <HighlightedPython code={dbCode} />
                </pre>
              ) : (
                <EmptyState title="No DB code yet" detail="Run Parser or save JSON source to generate DB code." />
              )}
            </div>
          )}
          </ParserInspectorErrorBoundary>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* TOP BAR */}
      <header className="flex h-12 items-center gap-3 border-b border-border bg-surface/85 px-3 backdrop-blur">
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <button
            onClick={() => setSidebarOpen((s) => !s)}
            className="flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground"
            title={sidebarOpen ? "Hide collection" : "Show collection"}
            aria-label="Toggle collection"
          >
            <PanelLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <img src={favicon} alt="logo" className="h-6 w-6" />
          <h1 className="m-0 hidden p-0 text-[15px] font-semibold leading-none tracking-tight sm:block">
            <span className="text-primary">curl</span>
            <span className="text-muted-foreground">2</span>
            <span className="text-foreground">py</span>
          </h1>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={topbarButtonClass} title="Requests">
                <span className="text-foreground">{snippets.length}</span>
                <span className="hidden sm:inline">Snippet{snippets.length === 1 ? "" : "s"}</span>
                <ChevronDown className="h-3 w-3" strokeWidth={2} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className={modernMenuContentClass}>
              <DropdownMenuLabel className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">Requests</DropdownMenuLabel>
              {snippets.map((snippet, index) => (
                <DropdownMenuItem
                  key={snippet.id}
                  className={modernMenuItemClass}
                  onClick={() => {
                    setActiveWorkspaceId(snippet.id);
                    setActiveWorkspaceFile("request.py");
                    setActiveTabId(`req-${snippet.id}`);
                    setExpandedWorkspaceIds((prev) => new Set(prev).add(snippet.id));
                  }}
                >
                  <span className="truncate">{effectiveNames[index] || snippet.name || `request_${index + 1}`}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem className={modernMenuItemClass} onClick={handleAddSnippet}>
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                Add Request
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

         
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={topbarButtonClass} title={activeWorkspaceId ? `Open parser for ${activeWorkspaceDisplayName}` : "Open parser"}>
                  <FileCode className="h-3.5 w-3.5" strokeWidth={2} />
                  Parser
                  <ChevronDown className="h-3 w-3" strokeWidth={2} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={modernMenuContentClass}>
                <DropdownMenuItem className={modernMenuItemClass} onClick={() => openParserPage("json")}>
                  JSON Parser
                </DropdownMenuItem>
                <DropdownMenuItem className={modernMenuItemClass} onClick={openHtmlParser}>
                  HTML Parser
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              onClick={() => void handleSyncBackend({ force: true })}
              disabled={isSyncingBackend || snippets.length === 0}
              className={topbarPrimaryButtonClass}
              title="Regenerate Python locally"
            >
              {isSyncingBackend ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <Upload className="h-3.5 w-3.5" strokeWidth={2} />}
              <span className="hidden sm:inline">{isSyncingBackend ? "Converting..." : "Generate"}</span>
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={topbarButtonClass} title="Feasibility tools">
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
                  <span className="hidden md:inline">Feasibility</span>
                  <ChevronDown className="h-3 w-3" strokeWidth={2} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={modernMenuContentClass}>
                <DropdownMenuItem
                  className={modernMenuItemClass}
                  disabled={!activeWorkspaceId || !activeFeasibilityRequest?.url}
                  onClick={() => void handleGenerateLocalFeasibilityCode()}
                >
                  Generate Local Code
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* <div className={cn(
              "hidden max-w-[150px] truncate rounded-sm border px-2 py-1.5 font-mono text-[11px] md:block",
              workspaceSaveState === "error" || workspaceSaveState === "session-expired"
                ? "border-destructive/40 bg-destructive/5 text-destructive"
                : workspaceSaveState === "saving"
                  ? "border-border bg-background/25 text-muted-foreground"
                  : "border-border bg-background/25 text-success"
            )}>
              {saveStatusLabel}
            </div> */}

            <button
              onClick={handleManualWorkspaceSave}
              disabled={!user || workspaceSaveState === "saving"}
              className={topbarButtonClass}
              title={user ? "Save workspace now" : "Login to save workspace"}
            >
              {workspaceSaveState === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <Save className="h-3.5 w-3.5" strokeWidth={2} />}
              <span className="hidden md:inline">Save</span>
            </button>

            <button
              onClick={() => void handleRunActiveWorkspace()}
              disabled={!activeWorkspaceId || isRunning}
              className={topbarRunButtonClass}
              title={activeWorkspaceId ? `Run ${activeWorkspaceDisplayName}` : "Select a workspace to run"}
            >
              {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <Play className="h-3.5 w-3.5" strokeWidth={2} />}
              {isRunning ? "Running..." : "Run"}
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={topbarButtonClass} title="Tools">
                  <Wrench className="h-3.5 w-3.5" strokeWidth={2} />
                  <span className="hidden xl:inline">Tools</span>
                  <ChevronDown className="h-3 w-3" strokeWidth={2} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={modernMenuContentClass}>
                <DropdownMenuItem className={modernMenuItemClass} onClick={() => setMergeMode((s) => !s)}>
                  <FileCode className="h-3.5 w-3.5" strokeWidth={2} />
                  {mergeMode ? "Disable Merge Scripts" : "Merge Scripts"}
                </DropdownMenuItem>
                <DropdownMenuItem className={modernMenuItemClass} disabled={visibleTabs.length === 0} onClick={handleDownloadAll}>
                  <Download className="h-3.5 w-3.5" strokeWidth={2} />
                  Download All
                </DropdownMenuItem>
                {/* <DropdownMenuItem className={modernMenuItemClass} onClick={openRaiseIssueDialog}>
                  <AlertCircle className="h-3.5 w-3.5" strokeWidth={2} />
                  Raise Issue
                </DropdownMenuItem> */}
              </DropdownMenuContent>
            </DropdownMenu>

            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className={topbarButtonClass} title="User menu">
                    <UserCircle className="h-3.5 w-3.5" strokeWidth={2} />
                    <span className="hidden max-w-[120px] truncate sm:inline">{user.username}</span>
                    <ChevronDown className="h-3 w-3" strokeWidth={2} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className={modernMenuContentClass}>
                  <DropdownMenuLabel className="px-2 py-1.5 text-[12px]">
                    <div className="truncate text-foreground">{user.username}</div>
                    <div className="truncate text-[11px] font-normal text-muted-foreground">{user.email}</div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-border" />
                  <DropdownMenuItem className={modernMenuItemClass} disabled>
                    Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem className={modernMenuItemClass} onClick={() => setTheme((value) => value === "dark" ? "light" : "dark")}>
                    {theme === "dark" ? <Sun className="h-3.5 w-3.5" strokeWidth={2} /> : <Moon className="h-3.5 w-3.5" strokeWidth={2} />}
                    {theme === "dark" ? "Light Theme" : "Dark Theme"}
                  </DropdownMenuItem>
                  <DropdownMenuItem className={modernMenuItemClass} onClick={openRaiseIssueDialog}>
                    <AlertCircle className="h-3.5 w-3.5" strokeWidth={2} />
                    Raise Issue
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-border" />
                  <DropdownMenuItem className={cn(modernMenuItemClass, "text-destructive focus:text-destructive")} onClick={handleLogout}>
                    <LogOut className="h-3.5 w-3.5" strokeWidth={2} />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Link to="/login" className={topbarPrimaryButtonClass} title="Login or sign up to save your collections">
                <LogIn className="h-3.5 w-3.5" strokeWidth={2} />
                Login
              </Link>
            )}
          </div>
        </div>
      </header>

      <Dialog open={!!pendingParserReplacePath} onOpenChange={(open) => !open && setPendingParserReplacePath(null)}>
        <DialogContent className="max-w-sm border-border bg-background font-mono text-foreground">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Replace parser.py?</DialogTitle>
          </DialogHeader>
          <div className="text-[12px] leading-5 text-muted-foreground">
            This request has custom parser code. Adding this path will replace it with generated parser code.
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setPendingParserReplacePath(null)}
              className={quietToolbarButtonClass}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                const path = pendingParserReplacePath;
                setPendingParserReplacePath(null);
                if (path) addPathToParser(path, { replaceCustomParser: true });
              }}
              className={primaryToolbarButtonClass}
            >
              Replace
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={raiseIssueOpen} onOpenChange={setRaiseIssueOpen}>
        <DialogContent className="max-w-md border-border bg-background font-mono text-foreground">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Raise an Issue</DialogTitle>
          </DialogHeader>
          {submittedIssueId ? (
            <div className="space-y-4 text-[12px] leading-6">
              <div className="rounded-sm border border-success/40 bg-success/5 px-3 py-2 text-success">
                Issue submitted. Your issue ID is: {submittedIssueId}
                <div className="text-muted-foreground">Please save this ID for tracking.</div>
              </div>
              <DialogFooter>
                <button
                  onClick={() => {
                    setRaiseIssueOpen(false);
                    navigate(`/issues?q=${encodeURIComponent(submittedIssueId)}`);
                  }}
                  className={quietToolbarButtonClass}
                >
                  Track Issue
                </button>
                <button
                  onClick={() => void copyText(submittedIssueId, "Copied issue ID")}
                  className={quietToolbarButtonClass}
                >
                  <Copy className="h-3 w-3" strokeWidth={2} />
                  Copy Issue ID
                </button>
                <button
                  onClick={() => setRaiseIssueOpen(false)}
                  className={quietToolbarButtonClass}
                >
                  Close
                </button>
              </DialogFooter>
            </div>
          ) : (
            <form className="space-y-3 text-[12px]" onSubmit={(event) => void handleSubmitIssue(event)}>
              <label className="block space-y-1">
                <span className="text-muted-foreground">Issue Type / Page</span>
                <select
                  value={issueType}
                  onChange={(event) => setIssueType(event.target.value)}
                  className="h-8 w-full rounded-sm border border-border bg-background px-2 font-mono text-[12px] text-foreground outline-none focus:border-border-strong"
                >
                  <option value="Workspace">Workspace</option>
                  <option value="Parser">Parser</option>
                  <option value="Login">Login</option>
                  <option value="Response Viewer">Response Viewer</option>
                  <option value="Other">Other</option>
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-muted-foreground">Issue Description</span>
                <textarea
                  value={issueDescription}
                  onChange={(event) => setIssueDescription(event.target.value)}
                  required
                  className="min-h-24 w-full resize-y rounded-sm border border-border bg-background px-2 py-2 font-mono text-[12px] text-foreground outline-none focus:border-border-strong"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-muted-foreground">Account Email</span>
                <div className="h-8 w-full rounded-sm border border-border bg-surface-elevated px-2 py-2 font-mono text-[12px] text-muted-foreground">
                  {user?.email || "Login required"}
                </div>
              </label>
              <label className="block space-y-1">
                <span className="text-muted-foreground">Upload Files</span>
                <input
                  type="file"
                  multiple
                  accept=".png,.jpg,.jpeg,.webp,.txt,.log,.json,image/png,image/jpeg,image/webp,text/plain,application/json"
                  onChange={(event) => setIssueFiles(Array.from(event.target.files ?? []))}
                  className="block w-full text-[11px] text-muted-foreground file:mr-3 file:rounded-sm file:border file:border-border file:bg-background file:px-2 file:py-1 file:font-mono file:text-foreground"
                />
              </label>
              <DialogFooter>
                <button
                  type="button"
                  onClick={() => {
                    setRaiseIssueOpen(false);
                    navigate("/issues");
                  }}
                  className={quietToolbarButtonClass}
                >
                  Track Issue
                </button>
                <button
                  type="button"
                  onClick={() => setRaiseIssueOpen(false)}
                  className={quietToolbarButtonClass}
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingIssue}
                  className={primaryToolbarButtonClass}
                >
                  {isSubmittingIssue ? <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} /> : null}
                  {isSubmittingIssue ? "Sending..." : "Send"}
                </button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={htmlParserOpen} onOpenChange={setHtmlParserOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-border bg-background p-4 font-mono text-foreground sm:p-6">
          <DialogHeader className="min-w-0">
            <DialogTitle className="text-[15px]">HTML Parser</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 min-w-0 space-y-3 overflow-y-auto pr-1 text-[12px]">
            <div className="rounded-sm border border-border bg-surface px-3 py-3">
              <div className="font-semibold text-foreground">Extract JSON from script tag</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Scan the current HTML response and choose the script JSON block to save.
              </div>
              <button onClick={scanHtmlScriptJson} className={cn(primaryToolbarButtonClass, "mt-3")}>
                Extract JSON
              </button>
            </div>

            {htmlScriptJsonSources.length > 0 && (
              <div className="min-w-0 space-y-2">
                <div className="text-[11px] text-muted-foreground">
                  Found {htmlScriptJsonSources.length} script JSON block{htmlScriptJsonSources.length === 1 ? "" : "s"}. Select one to save.
                </div>
                <div className="max-h-[min(46vh,24rem)] min-w-0 space-y-2 overflow-y-auto overflow-x-hidden pr-1">
                  {htmlScriptJsonSources.map((source) => (
                    <label
                      key={source.scriptId}
                      className={cn(
                        "block min-w-0 cursor-pointer overflow-hidden rounded-sm border px-3 py-2 transition-colors",
                        selectedHtmlScriptJsonId === source.scriptId
                          ? "border-primary/60 bg-primary/10"
                          : "border-border bg-background hover:border-border-strong"
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <input
                          type="radio"
                          name="html-script-json"
                          value={source.scriptId}
                          checked={selectedHtmlScriptJsonId === source.scriptId}
                          onChange={() => setSelectedHtmlScriptJsonId(source.scriptId)}
                          className="shrink-0"
                        />
                        <span className="min-w-0 truncate font-semibold text-foreground" title={source.title}>
                          {source.title}
                        </span>
                      </div>
                      <div className="mt-2 max-h-28 min-w-0 overflow-y-auto overflow-x-hidden rounded-sm border border-border/70 bg-surface px-2 py-1.5">
                        <pre className="max-w-full whitespace-pre-wrap break-all text-[10px] leading-4 text-muted-foreground">
                          {source.json.slice(0, 500)}
                        </pre>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-sm border border-border bg-surface px-3 py-2 text-[11px] text-muted-foreground">
              CSS selector parsing, XPath parsing, DOM table extraction, and other HTML actions: Coming soon.
            </div>
          </div>
          <DialogFooter className="shrink-0 gap-2 sm:space-x-0">
            <button onClick={() => setHtmlParserOpen(false)} className={cn(quietToolbarButtonClass, "w-full justify-center whitespace-nowrap sm:w-auto")}>
              Close
            </button>
            <button
              onClick={saveExtractedHtmlScriptJson}
              disabled={!selectedHtmlScriptJsonId}
              className={cn(primaryToolbarButtonClass, "w-full justify-center whitespace-nowrap sm:w-auto")}
            >
              Save and Open JSON Parser
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* OPTIONS */}
      {/* {optionsOpen && (
        <div className="flex animate-fade-in items-center gap-6 border-b border-border bg-surface px-4 py-2 text-[11px]">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">client</span>
            <SegToggle
              value={client}
              options={["requests", "httpx"]}
              onChange={(v) => setClient(v as Client)}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">mode</span>
            <SegToggle
              value={isAsync ? "async" : "sync"}
              options={["sync", "async"]}
              onChange={(v) => setIsAsync(v === "async")}
              disabled={client === "requests" ? ["async"] : []}
            />
          </div>
          {client === "requests" && (
            <span className="text-syntax-comment">
              # async only available for httpx
            </span>
          )}
        </div>
      )} */}

      {/* MAIN */}
      <div className="flex flex-1 min-h-0">
        {/* SIDEBAR */}
        {sidebarOpen && (
          <aside className="flex w-48 shrink-0 flex-col border-r border-border bg-surface">
            <div className="flex h-8 items-center justify-between border-b border-border px-3">
              <span className="label-eyebrow">COLLECTION</span>
              <button
                onClick={handleAddCollection}
                className="flex h-5 w-5 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                title="Add collection"
                aria-label="Add collection"
              >
                <Plus className="h-3 w-3" strokeWidth={2} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-1.5 scrollbar-thin">
              {Object.keys(collections).length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-muted-foreground">
                  No collections yet
                </div>
              ) : (
                Object.values(collections).map((collection) => {
                  const collectionBlocks = collection.id === activeCollection.id
                    ? blocks
                    : collection.snippets.map((s) => ({
                        id: s.id,
                        name: s.name,
                        raw: s.raw,
                        parsed: parseCurl(s.raw.trim() ? s.raw : "curl"),
                      }));
                  const collectionNames = collection.id === activeCollection.id
                    ? effectiveNames
                    : resolveEffectiveNames(collection.snippets);
                  const isActiveCollection = collection.id === activeCollection.id;
                  return (
                    <div key={collection.id} className="group border-l-2 border-transparent">
                      <div
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] font-mono transition-colors",
                          isActiveCollection
                            ? "bg-primary/[0.07] text-foreground"
                            : "text-muted-foreground hover:bg-surface-elevated hover:text-foreground"
                        )}
                        title={collection.name}
                      >
                        <button
                          onClick={() => toggleCollection(collection.id)}
                          className="flex h-3 w-3 shrink-0 items-center justify-center"
                          aria-label={collection.expanded ? "Collapse collection" : "Expand collection"}
                        >
                          {collection.expanded ? (
                            <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={2} />
                          ) : (
                            <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={2} />
                          )}
                        </button>
                        <FolderOpen className="h-3 w-3 shrink-0" strokeWidth={2} />
                        {editingCollectionId === collection.id ? (
                          <input
                            value={editingCollectionName}
                            onChange={(e) => setEditingCollectionName(e.target.value)}
                            onBlur={commitRenameCollection}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitRenameCollection();
                              if (e.key === "Escape") setEditingCollectionId(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            autoFocus
                            className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-foreground outline-none"
                          />
                        ) : (
                          <button
                            onClick={() => startRenameCollection(collection.id)}
                            className="min-w-0 flex-1 truncate text-left"
                            title="Rename collection"
                          >
                            {collection.name}
                          </button>
                        )}
                        <button
                          onClick={() => startRenameCollection(collection.id)}
                          className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                          title="Rename collection"
                          aria-label="Rename collection"
                        >
                          <Pencil className="h-3 w-3" strokeWidth={2} />
                        </button>
                        <button
                          onClick={() => handleDeleteCollection(collection.id)}
                          className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                          title="Delete collection"
                          aria-label="Delete collection"
                        >
                          <Trash2 className="h-3 w-3" strokeWidth={2} />
                        </button>
                      </div>

                      {collection.expanded && (
                        <div className="ml-3 border-l border-border/70 py-1">
                          {collectionBlocks.map((b, i) => {
                            const isActiveWorkspace = isActiveCollection && activeWorkspaceId === b.id;
                            const isExpanded = expandedWorkspaceIds.has(b.id);
                            const hasError = !b.raw.trim() || !!b.parsed.error;
                            const method = (b.parsed.method || "GET").toUpperCase();
                            const artifact = collection.workspaceArtifacts[b.id];
                            const responseFileName = artifact?.responseFileName ?? defaultResponseFileName(collectionNames[i]);
                            const requestCode = collection.backendOutputs[b.id] ?? "";
                            const collectionUsesPipeline = Object.values(collection.backendOutputs).some(scriptUsesPipeline);
                            const files: WorkspaceFile[] = [
                              "request.py",
                              "parser.py",
                              ...(collectionUsesPipeline && scriptUsesPipeline(requestCode) ? ["pipeline_utils.py"] : []),
                              responseFileName,
                              ...Object.keys(artifact?.responseOutputs ?? {}).filter((file) => file !== responseFileName),
                              ...(artifact?.dbCode ? ["db.py"] : []),
                            ];
                            return (
                              <div key={b.id}>
                                <div
                                  onClick={() => toggleWorkspace(b.id, collection.id)}
                                  onMouseEnter={() => setHoveredSnippetId(b.id)}
                                  onMouseLeave={() => setHoveredSnippetId(null)}
                                  className={cn(
                                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] font-mono transition-colors",
                                    isActiveWorkspace
                                      ? "bg-primary/[0.07] text-foreground"
                                      : "text-muted-foreground hover:bg-surface-elevated hover:text-foreground",
                                    hasError && "text-destructive"
                                  )}
                                  title={b.parsed.url || "invalid"}
                                >
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleWorkspace(b.id, collection.id);
                                    }}
                                    className="flex h-3 w-3 shrink-0 items-center justify-center"
                                    aria-label={isExpanded ? "Collapse request" : "Expand request"}
                                  >
                                    {isExpanded ? (
                                      <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={2} />
                                    ) : (
                                      <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={2} />
                                    )}
                                  </button>
                                  <span className={cn(
                                    "shrink-0 text-[9px] font-semibold uppercase tracking-wider",
                                    hasError ? "text-destructive" : "text-syntax-function"
                                  )}>
                                    {method.slice(0, 4)}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate text-left">{collectionNames[i]}</span>
                                </div>

                                {isExpanded && (
                                  <div className="ml-3 border-l border-border/70 py-1">
                                    {files.map((file) => {
                                      const isSelected = isActiveCollection && activeWorkspaceId === b.id && activeWorkspaceFile === file;
                                      return (
                                        <button
                                          key={file}
                                          onClick={() => {
                                            if (activeCollection.id !== collection.id) selectCollection(collection.id);
                                            openWorkspaceFile(b.id, file, collection.id);
                                          }}
                                          className={cn(
                                            "flex w-full items-center gap-2 px-3 py-1 text-left font-mono transition-colors",
                                            isSelected
                                              ? "bg-primary/[0.07] text-foreground"
                                              : "text-muted-foreground hover:bg-surface-elevated hover:text-foreground"
                                          )}
                                        >
                                          <FileCode className="h-3 w-3 shrink-0" strokeWidth={2} />
                                          <span className="truncate text-[10px]">{file}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {isActiveCollection && mergeMode && validBlocks.length > 0 && (
                            <button
                              onClick={() => { setActivePanelTab("code"); setActiveWorkspaceFile("request.py"); setActiveTabId("merged"); setClosedTabIds((p) => { const n = new Set(p); n.delete("merged"); return n; }); }}
                              className={cn(
                                "flex w-full items-center gap-2 px-3 py-1 text-left font-mono transition-colors",
                                activeTab?.id === "merged"
                                  ? "bg-primary/[0.07] text-foreground"
                                  : "text-muted-foreground hover:bg-surface-elevated hover:text-foreground"
                              )}
                            >
                              <FileCode className="h-3 w-3 shrink-0" strokeWidth={2} />
                              <span className="truncate text-[10px]">main.py</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* <div className="flex items-center gap-1 border-t border-border p-2">
              <button
                onClick={handleSaveSession}
                className="flex flex-1 items-center justify-center gap-1 rounded-sm border border-border bg-transparent px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                title="Save current input + options to browser"
              >
                {savedSession ? (
                  <span className="flex items-center gap-1 text-success">
                    <Check className="h-3 w-3" strokeWidth={2.5} /> Saved
                  </span>
                ) : (
                  <>
                    <Save className="h-3 w-3" strokeWidth={2} /> Save
                  </>
                )}
              </button>
              <button
                onClick={handleLoadSession}
                className="flex flex-1 items-center justify-center gap-1 rounded-sm border border-border bg-transparent px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                title="Load saved session"
              >
                <FolderOpen className="h-3 w-3" strokeWidth={2} /> Load
              </button>
            </div> */}
          </aside>
        )}

        {/* MAIN SPLIT */}
        <main
          ref={mainRef}
          style={{ "--split-left": `${dividerPos}%` } as React.CSSProperties}
          className="relative grid flex-1 min-h-0 grid-cols-1 overflow-hidden md:[grid-template-columns:var(--split-left)_1px_minmax(0,1fr)]"
        >
          {/* LEFT - SNIPPET INPUT */}
          <section
            className="flex min-h-0 min-w-0 flex-col border-b border-border md:border-b-0"
          >
            <PanelHeader label={
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveInputTab("input")}
                  className={cn("label-eyebrow transition-colors", activeInputTab === "input" ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  Input
                </button>
                <button
                  onClick={() => setActiveInputTab("proxy")}
                  className={cn("label-eyebrow transition-colors", activeInputTab === "proxy" ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  Proxy
                </button>
              </div>
            } right={
              <span className="text-[10px] text-muted-foreground">
                {snippets.length > 0 ? `${snippets.length} snippet${snippets.length === 1 ? "" : "s"}` : "-"}
              </span>
            } />

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-thin">
              {activeInputTab === "proxy" ? (
                <div className="flex flex-col gap-3 p-3 font-mono text-[11px]">
                  <label className="flex items-center gap-2 text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={proxyConfig.enabled}
                      onChange={(e) => setProxyConfig((prev) => ({ ...prev, enabled: e.target.checked }))}
                      className="h-3 w-3"
                    />
                    Enable Proxy
                  </label>
                  <label className="flex flex-col gap-1 text-muted-foreground">
                    Proxy URL
                    <input
                      value={proxyConfig.url}
                      onChange={(e) => setProxyConfig((prev) => ({ ...prev, url: e.target.value }))}
                      placeholder="http://username:password@host:port"
                      spellCheck={false}
                      className="w-full rounded-sm border border-border bg-transparent px-2 py-1.5 font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-border-strong"
                    />
                  </label>
                  <p className="text-[10px] text-muted-foreground/70">
                    Used in generated Python requests code.
                  </p>
                </div>
              ) : (
              <div className="flex flex-col">
                {snippets.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
                    <FileCode className="h-6 w-6 text-muted-foreground/50" strokeWidth={1.5} />
                    <p className="font-mono text-[12px] text-muted-foreground">
                      No snippets yet
                    </p>
                    <p className="font-mono text-[11px] text-muted-foreground/70">
                      Add a snippet to see the request
                    </p>
                  </div>
                ) : (
                  snippets.map((s, i) => {
                    const block = blocks[i];
                    const isActive = activeReqIdx === i;
                    const isHover = hoveredSnippetId === s.id;
                    const dup = isDuplicate(s.name);
                    const hasError = s.raw.trim() && !!block?.parsed.error;
                    const collapsed = !!s.collapsed;
                    const method = (block?.parsed.method || "GET").toUpperCase();
                    const url = block?.parsed.url || "";
                    const previewUrl = url || (s.raw.trim() ? s.raw.trim().slice(0, 80) : "no curl yet");
                    return (
                      <div
                        key={s.id}
                        ref={(el) => { snippetRefs.current[s.id] = el; }}
                        onMouseEnter={() => setHoveredSnippetId(s.id)}
                        onMouseLeave={() => setHoveredSnippetId(null)}
                        onClick={() => focusSnippet(s.id)}
                        onDragOver={(e) => {
                          if (!dragId || dragId === s.id) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          if (dragOverId !== s.id) setDragOverId(s.id);
                        }}
                        onDragLeave={() => {
                          if (dragOverId === s.id) setDragOverId(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragId && dragId !== s.id) reorderSnippets(dragId, s.id);
                          setDragId(null);
                          setDragOverId(null);
                        }}
                        className={cn(
                          "group animate-fade-in border-b border-border transition-colors",
                          isActive
                            ? "border-l-2 border-l-primary bg-primary/[0.04]"
                            : isHover
                              ? "border-l-2 border-l-primary/40 bg-surface-elevated/40"
                              : "border-l-2 border-l-transparent",
                          dragId === s.id && "opacity-40",
                          dragOverId === s.id && dragId !== s.id && "border-t-2 border-t-primary"
                        )}
                      >
                        {/* Top row: drag + collapse + name + remove */}
                        <div className="flex items-center gap-2 px-3 pt-2">
                          <button
                            draggable
                            onDragStart={(e) => {
                              setDragId(s.id);
                              e.dataTransfer.effectAllowed = "move";
                              try { e.dataTransfer.setData("text/plain", s.id); } catch { /* ignore */ }
                            }}
                            onDragEnd={() => { setDragId(null); setDragOverId(null); }}
                            onClick={(e) => e.stopPropagation()}
                            className="flex h-4 w-4 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground/60 opacity-0 transition-opacity hover:text-foreground active:cursor-grabbing group-hover:opacity-100"
                            title="Drag to reorder"
                            aria-label="Drag to reorder snippet"
                          >
                            <GripVertical className="h-3 w-3" strokeWidth={2} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleCollapse(s.id); }}
                            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground"
                            title={collapsed ? "Expand" : "Collapse"}
                            aria-label={collapsed ? "Expand snippet" : "Collapse snippet"}
                          >
                            {collapsed ? (
                              <ChevronRight className="h-3 w-3" strokeWidth={2} />
                            ) : (
                              <ChevronDown className="h-3 w-3" strokeWidth={2} />
                            )}
                          </button>
                          <span className="select-none font-mono text-[10px] text-syntax-comment">
                            #{i + 1}
                          </span>
                          <input
                            ref={(el) => { nameInputRefs.current[s.id] = el; }}
                            value={s.name}
                            onChange={(e) => handleNameChange(s.id, e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            placeholder={`request_${i + 1}`}
                            spellCheck={false}
                            className={cn(
                              "min-w-0 flex-1 bg-transparent font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground/60",
                              dup && "text-destructive"
                            )}
                            aria-label="Snippet name"
                          />
                          {dup && (
                            <span className="flex items-center gap-1 text-[10px] text-destructive">
                              <AlertCircle className="h-3 w-3" strokeWidth={2} />
                              Duplicate
                            </span>
                          )}
                          <span className="hidden text-[10px] text-muted-foreground sm:inline">
                            {effectiveNames[i]}.py
                          </span>
                          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRemoveSnippet(s.id); }}
                              className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                              title="Remove snippet"
                              aria-label="Remove snippet"
                            >
                              <Trash2 className="h-3 w-3" strokeWidth={2} />
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 px-9 pt-1 font-mono text-[10px] text-muted-foreground">
                          <label
                            className="flex cursor-pointer items-center gap-1.5"
                            title="Uses a secure backend proxy during hosted runs. Proxy details are never shown or exported."
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={!!s.useBackendProxy}
                              onChange={(e) => updateSnippet(s.id, { useBackendProxy: e.target.checked })}
                              className="h-3 w-3"
                            />
                            Enable IP rotation
                          </label>
                          {!!s.useBackendProxy && (
                            <span className="text-primary/80">Backend proxy: enabled</span>
                          )}
                        </div>

                        {collapsed ? (
                          /* Collapsed preview: METHOD + url */
                          <div
                            onClick={(e) => { e.stopPropagation(); toggleCollapse(s.id); }}
                            className="flex cursor-pointer items-center gap-2 px-3 pb-2 pt-1 pl-9 font-mono text-[11px]"
                            title="Click to expand"
                          >
                            <span className={cn(
                              "shrink-0 text-[9px] font-semibold uppercase tracking-wider",
                              hasError ? "text-destructive" : "text-syntax-function"
                            )}>
                              {method}
                            </span>
                            <span className={cn(
                              "truncate",
                              url ? "text-muted-foreground" : "text-muted-foreground/60 italic"
                            )}>
                              {previewUrl}
                            </span>
                          </div>
                        ) : (
                          <>
                            {/* Curl textarea - auto-expand, auto-collapse on paste */}
                            <AutoTextarea
                              value={s.raw}
                              onChange={(v) => updateSnippet(s.id, { raw: v })}
                              onPasteCollapse={() => {
                                // Collapse this snippet shortly after a paste so user sees the preview
                                setTimeout(() => {
                                  setSnippets((prev) => prev.map((x) => x.id === s.id ? { ...x, collapsed: true } : x));
                                }, 50);
                              }}
                              placeholder="Paste your curl command here..."
                              hasError={!!hasError}
                            />

                            {hasError && (
                              <div className="px-3 pb-2 font-mono text-[10px] text-destructive">
                                {block?.parsed.error}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })
                )}

                {/* Add Request */}
                <div className="p-3">
                  <button
                    onClick={handleAddSnippet}
                    className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-primary/60 bg-primary/[0.08] px-3 py-2 text-[11px] font-mono text-primary transition-colors hover:bg-primary/[0.14] hover:text-primary"
                  >
                    <Plus className="h-3 w-3" strokeWidth={2} />
                    Add Request
                  </button>
                </div>
              </div>
              )}
            </div>
          </section>

          {/* RESIZABLE DIVIDER */}
          <div
            className={cn(
              "hidden md:block relative h-full w-px self-stretch bg-border",
              isDraggingDivider && "bg-primary"
            )}
            aria-label="Resize panels"
            role="separator"
          />

          <div
            onMouseDown={() => setIsDraggingDivider(true)}
            onPointerDown={() => setIsDraggingDivider(true)}
            className="hidden md:block absolute z-10 h-full w-4 -translate-x-1/2 cursor-col-resize touch-none bg-transparent"
            style={{ left: `calc(${dividerPos}% + 0.5px)` }}
            aria-label="Resize panels"
          />

          {/* RIGHT - OUTPUT */}
          <section ref={outputRef} className="flex min-h-0 min-w-0 flex-col">
           

            <div className="flex items-center border-b border-border bg-surface">
              <div className="flex min-w-0 flex-1 items-center gap-0 overflow-x-auto scrollbar-thin">
                {(["code", "response"] as WorkspacePanelTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActivePanelTab(tab)}
                    className={cn(
                      panelTabClass,
                      activePanelTab === tab
                        ? "bg-background text-foreground before:absolute before:inset-x-2 before:top-0 before:h-px before:bg-primary"
                        : "text-muted-foreground hover:bg-surface-elevated/80 hover:text-foreground"
                    )}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {activePanelTab === "code" ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex items-center gap-0 overflow-x-auto border-b border-border bg-surface scrollbar-thin">
                  {visibleTabs.length === 0 ? (
                    <div className="px-3 py-2 text-[11px] text-muted-foreground">No output yet</div>
                  ) : (
                    visibleTabs.map((t) => {
                      const isActive = t.id === activeTabId;
                      const hoverIdx = blocks.findIndex((b) => b.id === hoveredSnippetId);
                      const isHover = t.kind === "request" && t.reqIdx === hoverIdx && hoverIdx !== -1;
                      return (
                        <div
                          key={t.id}
                          onClick={() => {
                            setActiveTabId(t.id);
                            if (t.kind === "request" && t.reqIdx != null) {
                              const workspace = blocks[t.reqIdx];
                              if (workspace) {
                                setActiveWorkspaceId(workspace.id);
                                setActiveWorkspaceFile("request.py");
                                setExpandedWorkspaceIds((prev) => new Set(prev).add(workspace.id));
                              }
                            }
                          }}
                          onMouseEnter={() => {
                            if (t.kind === "request" && t.reqIdx != null) {
                              const b = blocks[t.reqIdx];
                              if (b) setHoveredSnippetId(b.id);
                            }
                          }}
                          onMouseLeave={() => t.kind === "request" && setHoveredSnippetId(null)}
                          className={cn(
                            fileTabClass,
                            isActive
                              ? "bg-background text-foreground before:absolute before:inset-x-2 before:top-0 before:h-px before:bg-primary"
                              : "text-muted-foreground hover:bg-surface-elevated/80 hover:text-foreground",
                            isHover && !isActive && "bg-surface-elevated text-foreground",
                            t.hasError && "text-destructive",
                          )}
                        >
                          {t.hasError && <AlertCircle className="h-3 w-3" strokeWidth={2} />}
                          {(t.kind === "merged" || t.kind === "parser") && (
                            <FileCode className={cn("h-3 w-3", isActive ? "text-primary" : "")} strokeWidth={2} />
                          )}
                          <span>{t.filename}{dirtyCodeTabs[t.id] ? "*" : ""}</span>
                          <button
                            onClick={(e) => handleCloseTab(t.id, e)}
                            className={cn(
                              "ml-1 flex h-3.5 w-3.5 items-center justify-center rounded-sm opacity-0 transition-opacity hover:bg-border-strong hover:text-foreground group-hover:opacity-100",
                              isActive && "opacity-60"
                            )}
                            aria-label={`Close ${t.filename}`}
                          >
                            <X className="h-2.5 w-2.5" strokeWidth={2.5} />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>

                {activeTab && (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <MetaRow tab={activeTab} blocks={blocks} names={effectiveNames} actions={currentFileActions} dirty={isActiveCodeDirty} saveStatus={saveStatusLabel} />

                    <div className="relative min-h-0 flex-1 overflow-auto">
                      {activeWorkspaceFile !== "parser.py" && activeWorkspaceFile !== "db.py" && activeTab.hasError && activeTab.kind === "request" ? (
                        <div className="m-3 rounded-sm border border-destructive/40 bg-destructive/5 p-3 text-[12px] text-destructive">
                          Issue in {effectiveNames[activeTab.reqIdx ?? 0]}
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {blocks[activeTab.reqIdx ?? 0]?.parsed.error || "Empty snippet - paste a curl command"}
                          </div>
                        </div>
                      ) : (
                        <CodeEditor
                          value={panelCodeContent}
                          filename={panelCodeFilename}
                          onChange={handleCodePanelChange}
                          wordWrap={codeWordWrap}
                          parserInsertGroups={activeWorkspaceFile === "request.py" && activeTab.kind === "request" ? parserInsertGroups : []}
                          className="absolute inset-0"
                        />
                      )}
                    </div>
                  </div>
                )}
                {!activeTab && (
                  <EmptyState title="No parser output yet" detail="Run a request or select an existing output file to view generated code." />
                )}
              </div>
            ) : activePanelTab === "response" ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex items-center gap-0 overflow-x-auto border-b border-border bg-surface scrollbar-thin">
                  {visibleResponseTabs.length === 0 ? (
                    <div className="px-3 py-2 text-[11px] text-muted-foreground">No response yet</div>
                  ) : (
                    visibleResponseTabs.map((tab) => {
                      const isActive = tab.id === activeResponseTab?.id;
                      return (
                        <div
                          key={tab.id}
                          onClick={() => {
                            setActiveResponseTabId(tab.id);
                            setActiveWorkspaceId(tab.workspaceId);
                            setActiveWorkspaceFile(tab.fileName);
                          }}
                          className={cn(
                            fileTabClass,
                            isActive
                              ? "bg-background text-foreground before:absolute before:inset-x-2 before:top-0 before:h-px before:bg-primary"
                              : "text-muted-foreground hover:bg-surface-elevated/80 hover:text-foreground"
                          )}
                        >
                          <FileCode className={cn("h-3 w-3", isActive ? "text-primary" : "")} strokeWidth={2} />
                          <span>{tab.label}</span>
                          <button
                            onClick={(e) => handleCloseResponseTab(tab.id, e)}
                            className={cn(
                              "ml-1 flex h-3.5 w-3.5 items-center justify-center rounded-sm opacity-0 transition-opacity hover:bg-border-strong hover:text-foreground group-hover:opacity-100",
                              isActive && "opacity-60"
                            )}
                            aria-label={`Close ${tab.label}`}
                          >
                            <X className="h-2.5 w-2.5" strokeWidth={2.5} />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="flex items-center gap-3 border-b border-border bg-background px-4 py-1.5 font-mono text-[11px]">
                  <span className="font-semibold text-primary">Status</span>
                  <span className="text-muted-foreground">{activeResponseMeta?.status ?? "-"}</span>
                  <span className="text-syntax-comment">|</span>
                  <span className="font-semibold text-primary">Time</span>
                  <span className="text-muted-foreground">{activeResponseMeta ? `${activeResponseMeta.time_ms ?? activeResponseMeta.time ?? 0}ms` : "-"}</span>
                  <span className="text-syntax-comment">|</span>
                  <span className="font-semibold text-primary">Size</span>
                  <span className="text-muted-foreground">{activeResponseMeta?.size ?? "-"}</span>
                  {currentFileActions}
                </div>
                <div className="relative min-h-0 flex-1 overflow-auto">
                  {activeResponseJson ? (
                    <ResponseBodyViewer
                      source={activeResponseJson}
                      filename={activeResponseTab?.fileName}
                      contentType={activeResponseContentType}
                      selectedPath={selectedParserPath}
                      addedPaths={addedParserPaths}
                      onAddToParser={addPathToParser}
                      onRemoveFromParser={removePathFromParser}
                      onSelectedPathChange={handleParserPathSelect}
                    />
                  ) : (
                    <EmptyState title="No response yet" detail="Run the selected request to inspect its response." />
                  )}
                </div>
              </div>
            ) : (
              <div className="relative min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[12px] leading-[1.6]">
                {activeLogsTxt ? (
                  activeLogsTxt.split("\n").map((line, index) => {
                    const lower = line.toLowerCase();
                    const isError = lower.includes("error") || lower.includes("failed");
                    return (
                      <div key={`${index}-${line}`} className={cn(isError && "text-destructive")}>
                        {line || "\u00a0"}
                      </div>
                    );
                  })
                ) : (
                  <div className="text-[11px] text-muted-foreground">No logs yet</div>
                )}
              </div>
            )}
          </section>
        </main>
      </div>

      {/* STATUS BAR */}
      <footer className="flex h-7 items-center justify-between border-t border-border bg-surface px-3 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-block h-1.5 w-1.5 rounded-full",
              statusKind === "success" && "bg-success",
              statusKind === "error" && "bg-destructive",
              statusKind === "info" && "bg-muted-foreground/60"
            )}
          />
          <span
            className={cn(
              statusKind === "success" && "text-success",
              statusKind === "error" && "text-destructive"
            )}
          >
            {statusMsg}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {mergeMode && <span className="text-primary/80">merge</span>}
          <span>{visibleTabs.length} file{visibleTabs.length === 1 ? "" : "s"}</span>
          <span>{snippets.length} snippet{snippets.length === 1 ? "" : "s"}</span>
          <span className="hidden sm:inline">utf-8</span>
          <span>python</span>
        </div>
      </footer>
    </div>
  );
}

// Helpers

type ResponseMode =
  | { kind: "json"; value: unknown }
  | { kind: "html"; value: string };

function detectResponseMode(source: string): ResponseMode {
  try {
    const parsed = JSON.parse(source);
    return { kind: "json", value: parsed };
  } catch {
    return { kind: "html", value: source };
  }
}

function isHtmlResponse(source: string, contentType?: string) {
  const type = (contentType || "").toLowerCase();
  if (type.includes("text/html") || type.includes("html")) return true;
  const trimmed = source.trim().toLowerCase();
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html") || /<body[\s>]/i.test(source);
}

export function isPythonCodeFile(filename?: string, contentType?: string) {
  const type = (contentType || "").toLowerCase();
  return /\.py$/i.test(filename || "") || type.includes("python");
}

function normalizeHtmlSource(source: string) {
  try {
    const parsed = JSON.parse(source);
    return typeof parsed === "string" ? parsed : source;
  } catch {
    return source;
  }
}

function previewSourceLines(source: string, maxLines = 500, maxChars = 200000) {
  const lines = source.split(/\r?\n/);
  const byLines = lines.slice(0, maxLines).join("\n");
  const preview = byLines.length > maxChars ? byLines.slice(0, maxChars) : byLines;
  return {
    preview,
    isPreview: lines.length > maxLines || source.length > preview.length,
  };
}

function extractBalancedJsonLike(text: string, start: number) {
  const opener = text[start];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) inString = false;
      continue;
    }
    if (char === "'" || char === "\"") {
      inString = true;
      quote = char;
    } else if (char === opener) {
      depth += 1;
    } else if (char === closer) {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return "";
}

function findBalancedJsonCandidates(text: string) {
  const candidates: Array<{ raw: string; start: number }> = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "{" && text[index] !== "[") continue;
    const raw = extractBalancedJsonLike(text, index);
    if (raw) {
      candidates.push({ raw, start: index });
      index += raw.length - 1;
    }
  }
  return candidates;
}

function parseJsonPayload(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractJsonFromScriptText(script: string, directJson = false): ScriptJsonTextExtraction {
  if (directJson) {
    return { ok: true, value: parseJsonPayload(script), raw: script, mode: "json" };
  }

  const validCandidates: Array<{ value: unknown; raw: string; mode: "json" | "assignment" }> = [];
  const assignment = /(?:window\.)?[A-Za-z_$][\w$]*(?:\s*=\s*)|(?:var|let|const)\s+[A-Za-z_$][\w$]*\s*=\s*/g;
  let match: RegExpExecArray | null;
  while ((match = assignment.exec(script))) {
    const start = script.slice(match.index + match[0].length).search(/[{[]/);
    if (start === -1) continue;
    const absoluteStart = match.index + match[0].length + start;
    const jsonLike = extractBalancedJsonLike(script, absoluteStart);
    if (!jsonLike) continue;
    validCandidates.push({ value: parseJsonPayload(jsonLike), raw: jsonLike, mode: "assignment" });
  }

  findBalancedJsonCandidates(script).forEach((candidate) => {
    try {
      validCandidates.push({ value: JSON.parse(candidate.raw), raw: candidate.raw, mode: "json" });
    } catch {
      // Ignore non-assignment blocks unless they are valid JSON.
    }
  });

  const best = validCandidates.sort((a, b) => b.raw.length - a.raw.length)[0];
  if (best) return { ok: true, ...best };
  return { ok: false, error: "No script JSON found" };
}

function stringifyJsonValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function getJsonValueType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function getJsonValuePreview(value: unknown): string {
  const text = stringifyJsonValue(value);
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

function formatJsonPath(path: Array<string | number>): string {
  return path.reduce<string>((acc, part) => {
    if (typeof part === "number") return `${acc}[${part}]`;
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(part)) return acc ? `${acc}.${part}` : part;
    return `${acc}[${JSON.stringify(part)}]`;
  }, "");
}

interface JsonPathToken {
  type: "key" | "index";
  value: string | number;
}

function tokenizeJsonPath(path: string): JsonPathToken[] | null {
  const trimmed = path.trim();
  if (!trimmed) return null;
  const tokens: JsonPathToken[] = [];
  let index = 0;
  let needsKey = true;

  const findClosingBracket = (start: number) => {
    let quote: string | null = null;
    let escaped = false;
    for (let pos = start + 1; pos < trimmed.length; pos += 1) {
      const current = trimmed[pos];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (current === "\\") {
        escaped = true;
        continue;
      }
      if (quote) {
        if (current === quote) quote = null;
        continue;
      }
      if (current === "\"" || current === "'") {
        quote = current;
        continue;
      }
      if (current === "]") return pos;
    }
    return -1;
  };

  while (index < trimmed.length) {
    const char = trimmed[index];

    if (char === ".") {
      if (needsKey) return null;
      needsKey = true;
      index += 1;
      continue;
    }

    if (char === "[") {
      const closeIndex = findClosingBracket(index);
      if (closeIndex === -1) return null;
      const raw = trimmed.slice(index + 1, closeIndex);
      if (/^\d+$/.test(raw)) {
        tokens.push({ type: "index", value: Number(raw) });
      } else if (
        (raw.startsWith("\"") && raw.endsWith("\"")) ||
        (raw.startsWith("'") && raw.endsWith("'"))
      ) {
        try {
          const key = raw.startsWith("'")
            ? raw.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, "\"")
            : JSON.parse(raw);
          if (typeof key !== "string") return null;
          tokens.push({ type: "key", value: key });
        } catch {
          return null;
        }
      } else {
        return null;
      }
      needsKey = false;
      index = closeIndex + 1;
      continue;
    }

    const keyEnd = (() => {
      const dotIndex = trimmed.indexOf(".", index);
      const bracketIndex = trimmed.indexOf("[", index);
      if (dotIndex === -1) return bracketIndex === -1 ? trimmed.length : bracketIndex;
      if (bracketIndex === -1) return dotIndex;
      return Math.min(dotIndex, bracketIndex);
    })();
    const key = trimmed.slice(index, keyEnd);
    if (!key || !needsKey) return null;
    tokens.push({ type: "key", value: key });
    needsKey = false;
    index = keyEnd;
  }

  return tokens.length > 0 && !needsKey ? tokens : null;
}

export function parseJsonPath(path: string): Array<string | number> {
  const tokens = tokenizeJsonPath(path);
  if (!tokens) return path.trim() ? [path.trim()] : [];
  return tokens.map((token) => token.value);
}

export function getValueByPath(data: unknown, path: string): unknown {
  if (
    data !== null &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    path in data
  ) {
    return (data as Record<string, unknown>)[path];
  }

  const tokens = tokenizeJsonPath(path);
  if (!tokens) return undefined;
  let current = data;

  for (const token of tokens) {
    if (current == null) return undefined;

    if (token.type === "key") {
      if (
        typeof current !== "object" ||
        Array.isArray(current) ||
        !(token.value in current)
      ) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[token.value as string];
      continue;
    }

    if (!Array.isArray(current)) return undefined;
    const itemIndex = token.value as number;
    if (itemIndex < 0 || itemIndex >= current.length) return undefined;
    current = current[itemIndex];
  }

  return current;
}

function jsonPathExists(data: unknown, path: string): boolean {
  if (!path.trim()) return false;
  return getValueByPath(data, path) !== undefined;
}

function parseJsonSourceValue(source: string | null | undefined): unknown | null {
  if (!source?.trim()) return null;
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

function jsonPathExistsInSource(source: string | null | undefined, path: string): boolean {
  const data = parseJsonSourceValue(source);
  return data !== null && jsonPathExists(data, path);
}

function getParserPathExistenceWarning(path: string, source: string | null | undefined) {
  if (!path.trim() || !source?.trim()) return "";
  return jsonPathExistsInSource(source, path) ? "" : "Path not found in JSON";
}

function filterSelectionsByJsonSource(selections: ParserSelection[], source: string | null | undefined) {
  const data = parseJsonSourceValue(source);
  if (data === null) return selections;
  return selections.filter((selection) => jsonPathExists(data, selection.path));
}

function getJsonPathSyntaxWarning(path: string) {
  return "";
}

function sanitizeOutputKey(value: string): string {
  const snake = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return snake || "value";
}

function uniqueOutputKey(baseKey: string, selections: ParserSelection[]) {
  const used = new Set(selections.map((selection) => selection.outputKey));
  if (!used.has(baseKey)) return baseKey;
  let index = 2;
  while (used.has(`${baseKey}_${index}`)) index += 1;
  return `${baseKey}_${index}`;
}

export function getParserPathWarning(path: string) {
  return getJsonPathSyntaxWarning(path);
}

function getOutputKeyFromPath(path: string, fallback = "value") {
  const parts = normalizeSelectionParts(path);
  const lastKey = [...parts].reverse().find((part): part is string => typeof part === "string");
  return sanitizeOutputKey(lastKey || fallback);
}

interface JsonLoopInfo {
  parentPath: Array<string | number>;
  relativePath: Array<string | number>;
  label: string;
}

function getJsonLoopInfoFromParts(parts: Array<string | number>): JsonLoopInfo | null {
  const arrayIndex = findNextArray(parts);
  if (arrayIndex === -1) return null;
  const parentPath = parts.slice(0, arrayIndex + 1);
  const labelPart = parentPath[parentPath.length - 1];
  return {
    parentPath,
    relativePath: parts.slice(arrayIndex + 2),
    label: typeof labelPart === "string" ? labelPart : "items",
  };
}

export function getJsonLoopParentPath(path: string): string | null {
  if (getParserPathWarning(path)) return null;
  const info = getJsonLoopInfoFromParts(normalizeSelectionParts(path));
  return info ? formatJsonPath(info.parentPath) : null;
}

function getJsonLoopCandidatesFromParts(parts: Array<string | number>): JsonLoopCandidate[] {
  const candidates: JsonLoopCandidate[] = [];
  const labels: string[] = [];
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (typeof parts[index] !== "string" || typeof parts[index + 1] !== "number") continue;
    const parentPath = parts.slice(0, index + 1);
    const label = String(parts[index]);
    labels.push(label);
    const displayParts = parentPath.filter((part, partIndex) => (
      typeof part !== "number" || !(partIndex > 0 && typeof parentPath[partIndex - 1] === "string")
    ));
    candidates.push({
      parentPath,
      parentKey: pathKey(parentPath),
      displayPath: formatJsonPath(displayParts).replace(/([A-Za-z_$][A-Za-z0-9_$]*)(?=\.|$)/g, (match, _name, offset, text) => {
        const next = text.slice(offset + match.length, offset + match.length + 2);
        return next === "[]" ? match : match;
      }),
      label,
      shortLabel: labels.length === 1 ? `Loop over ${label}` : `Loop over ${labels.join(" \u2192 ")}`,
      sourceIndex: index,
    });
  }
  return candidates.map((candidate) => ({
    ...candidate,
    displayPath: formatLoopDisplayPath(candidate.parentPath),
  }));
}

function formatLoopDisplayPath(path: Array<string | number>) {
  let value = "";
  path.forEach((part, index) => {
    if (typeof part === "number") {
      value += "[]";
      return;
    }
    const simpleKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(part);
    if (value && simpleKey) value += ".";
    value += simpleKey ? part : `[${JSON.stringify(part)}]`;
  });
  return value;
}

export function getJsonLoopSourcePaths(path: string): string[] {
  if (getParserPathWarning(path)) return [];
  return getJsonLoopCandidatesFromParts(normalizeSelectionParts(path)).map((candidate) => candidate.displayPath);
}

function getSelectedJsonLoopCandidates(
  selection: ParserSelection,
  candidates: JsonLoopCandidate[],
  loopCounts: Map<string, number>,
) {
  if (candidates.length === 0) return [];
  if (selection.selectionMode === "single") return [];

  const explicitLoopPaths = selection.loopPaths ?? [];
  const explicit = explicitLoopPaths.length > 0
    ? candidates.filter((candidate) => (
      explicitLoopPaths.includes(candidate.displayPath) ||
      explicitLoopPaths.includes(formatJsonPath(candidate.parentPath)) ||
      explicitLoopPaths.includes(candidate.parentKey)
    ))
    : [];
  if (explicit.length > 0) return explicit;
  if (selection.selectionMode === "loop") return [candidates[0]];
  if (selection.selectionMode === undefined && candidates.length > 0) {
    if (loopCounts.get(candidates[0].parentKey)! > 1) {
      return [candidates[0]];
    }
  }
  return [];
}

function isLoopPrefix(prefix: SelectedLoopCandidate[], value: SelectedLoopCandidate[]) {
  return prefix.length <= value.length && prefix.every((loop, index) => loop.parentKey === value[index]?.parentKey);
}

function selectedLoopChainKey(loops: SelectedLoopCandidate[]) {
  return loops.map((loop) => loop.parentKey).join("|");
}

function relativePathAfterLoop(path: Array<string | number>, loop: SelectedLoopCandidate) {
  const offset = loop.parentPath.length;
  return pathKey(path.slice(0, offset)) === pathKey(loop.parentPath)
    ? path.slice(offset + 1)
    : path;
}

function relativeCollectionPath(loop: SelectedLoopCandidate, previous?: SelectedLoopCandidate) {
  if (!previous) return loop.parentPath;
  const offset = previous.parentPath.length;
  return pathKey(loop.parentPath.slice(0, offset)) === pathKey(previous.parentPath)
    ? loop.parentPath.slice(offset + 1)
    : loop.parentPath;
}

function emitNestedJsonLoopPlan(
  lines: string[],
  plan: JsonLoopOutputPlan,
  loopIndex: number,
  baseVar: string,
  indent: string,
  usedVars: Set<string>,
) {
  const loop = plan.loops[loopIndex];
  const previous = loopIndex > 0 ? plan.loops[loopIndex - 1] : undefined;
  const itemVar = loop.varName || uniquePythonVar(loopIndex === plan.loops.length - 1 ? "item" : singularName(loop.label), usedVars);
  loop.varName = itemVar;
  const collectionVar = uniquePythonVar(`${itemVar}s`, usedVars);
  const collectionPath = relativeCollectionPath(loop, previous);

  lines.push(`${indent}${collectionVar} = ${collectionExpression(baseVar, collectionPath)}`);
  lines.push(`${indent}for ${itemVar} in _as_list(${collectionVar}):`);
  lines.push(`${indent}    if not isinstance(${itemVar}, dict):`);
  lines.push(`${indent}        continue`);

  if (loopIndex < plan.loops.length - 1) {
    emitNestedJsonLoopPlan(lines, plan, loopIndex + 1, itemVar, `${indent}    `, usedVars);
    return;
  }

  lines.push(`${indent}    row = {`);
  plan.fields.forEach((field, index) => {
    const fieldLoop = field.loops[field.loops.length - 1];
    const planFieldLoop = fieldLoop ? plan.loops.find((loop) => loop.parentKey === fieldLoop.parentKey) : undefined;
    const fieldBase = planFieldLoop?.varName || itemVar;
    const relativePath = fieldLoop ? relativePathAfterLoop(field.path, fieldLoop) : field.path;
    const comma = index < plan.fields.length - 1 ? "," : "";
    lines.push(`${indent}        ${pythonString(field.outputKey)}: ${getFromExpression(fieldBase, relativePath)}${comma}`);
  });
  lines.push(`${indent}    }`);
  lines.push(`${indent}    if any(v is not None for v in row.values()):`);
  lines.push(`${indent}        result[${pythonString(plan.outputKey)}].append(row)`);
}

function optimizeParserSelections(selections: ParserSelection[]) {
  const usedPaths = new Set<string>();
  const optimized: ParserSelection[] = [];

  selections.forEach((selection) => {
    const path = selection.path.trim();
    if (getParserPathWarning(path) || usedPaths.has(path)) return;
    usedPaths.add(path);
    const baseKey = sanitizeOutputKey(selection.outputKey || getOutputKeyFromPath(path));
    optimized.push({
      path,
      outputKey: uniqueOutputKey(baseKey, optimized),
      selectionMode: selection.selectionMode ?? "single",
    });
  });

  return optimized;
}

function getJsonLoopContexts(selections: ParserSelection[]) {
  const contexts = new Set<string>();
  selections.forEach((selection) => {
    const parent = getJsonLoopParentPath(selection.path);
    if (parent) contexts.add(parent);
  });
  return Array.from(contexts);
}

function getPrimaryJsonLoopContext(selections: ParserSelection[]) {
  return getJsonLoopContexts(selections)[0] ?? "";
}

function getHtmlLoopContexts(selections: ParserSelection[]) {
  const contexts = new Set<string>();
  selections.forEach((selection) => {
    const selector = selection.parentSelector || selection.parentXpath || selection.parentCss;
    if (selector) contexts.add(selector);
  });
  return Array.from(contexts);
}

function getPrimaryHtmlLoopContext(selections: ParserSelection[]) {
  return getHtmlLoopContexts(selections)[0] ?? "";
}

function getParserOutputItemCount(output: unknown) {
  if (Array.isArray(output)) return output.length;
  const tableRows = getParserOutputTableRows(output);
  if (tableRows.length > 0) return tableRows.length;
  if (output && typeof output === "object") return 1;
  return output == null ? 0 : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isListOfRecords(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length > 0 && value.every(isRecord);
}

function getMainRecordArrayEntry(value: unknown): [string, Record<string, unknown>[]] | null {
  if (!isRecord(value)) return null;
  const entry = Object.entries(value).find(([, item]) => isListOfRecords(item));
  return entry ? [entry[0], entry[1] as Record<string, unknown>[]] : null;
}

function getParserOutputTableRows(value: unknown): Record<string, unknown>[] {
  if (isListOfRecords(value)) return value;
  const mainArray = getMainRecordArrayEntry(value);
  if (!mainArray || !isRecord(value)) return [];
  const [arrayKey, rows] = mainArray;
  const rootFields = Object.fromEntries(
    Object.entries(value).filter(([key, item]) => key !== arrayKey && !Array.isArray(item) && !isRecord(item))
  );
  return rows.map((row) => ({ ...rootFields, ...row }));
}

function getParserOutputSummary(output: unknown): string {
  if (Array.isArray(output)) return `${output.length} item${output.length === 1 ? "" : "s"}`;
  const mainArray = getMainRecordArrayEntry(output);
  if (mainArray) return `1 root object | ${mainArray[0]}: ${mainArray[1].length} item${mainArray[1].length === 1 ? "" : "s"}`;
  if (isRecord(output)) return "1 root object";
  return output == null ? "0 items" : "1 item";
}

type MysqlColumnKind = "json" | "string" | "int" | "float" | "boolean" | "null";

interface MysqlDbColumn {
  originalKey: string;
  columnName: string;
  kind: MysqlColumnKind;
  sqlType: string;
}

interface MysqlDbGeneration {
  sourceJson: string;
  code: string;
  error: string | null;
}

const SQL_KEYWORDS = new Set([
  "add", "all", "alter", "and", "as", "between", "by", "case", "check", "column", "create", "database", "default",
  "delete", "desc", "distinct", "drop", "else", "exists", "from", "group", "having", "id", "if", "in", "index",
  "insert", "into", "is", "join", "key", "like", "limit", "not", "null", "or", "order", "primary", "select", "set",
  "table", "then", "to", "update", "use", "values", "when", "where",
]);

function pluralizeTableName(value: string) {
  if (!value || value === "data") return "data";
  if (value.endsWith("s")) return value;
  if (value.endsWith("y") && !/[aeiou]y$/.test(value)) return `${value.slice(0, -1)}ies`;
  return `${value}s`;
}

function inferBaseTableName(contextName: string, payload: unknown) {
  const context = sanitizeOutputKey(contextName || "");
  if (/\b(product|products|sku|catalog|item|items)\b/.test(context)) return context.includes("product") ? "products" : pluralizeTableName(context);

  const sample = Array.isArray(payload) ? payload.find(isRecord) : isRecord(payload) ? payload : null;
  if (sample) {
    const keys = new Set(Object.keys(sample).map((key) => key.toLowerCase()));
    if (keys.has("product_name") || keys.has("sku") || keys.has("pricing") || keys.has("brand")) return "products";
    if (keys.has("user") || keys.has("username") || keys.has("email")) return "users";
    if (keys.has("category") || keys.has("category_name")) return "categories";
  }

  return context && !/^request_\d+$/.test(context) && context !== "manual_json" ? pluralizeTableName(context) : "data";
}

function sanitizeDbColumnName(key: string, used: Set<string>, baseTableName: string, recordLooksProduct: boolean) {
  const shouldPrefixUrl = key === "url" && recordLooksProduct;
  const raw = shouldPrefixUrl ? `${baseTableName.replace(/s$/, "")}_${key}` : key;
  let name = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  if (!name) name = "field";
  if (/^[0-9]/.test(name)) name = `field_${name}`;
  if (SQL_KEYWORDS.has(name)) name = `${name}_field`;

  const base = name;
  let suffix = 2;
  while (used.has(name)) {
    name = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(name);
  return name;
}

function mergeColumnKind(current: MysqlColumnKind | undefined, value: unknown): MysqlColumnKind {
  const next: MysqlColumnKind = value === null || value === undefined
    ? "null"
    : Array.isArray(value) || isRecord(value)
      ? "json"
      : typeof value === "boolean"
        ? "boolean"
        : typeof value === "number"
          ? Number.isInteger(value) ? "int" : "float"
          : "string";

  if (!current || current === "null") return next;
  if (next === "null" || current === next) return current;
  if ((current === "int" && next === "float") || (current === "float" && next === "int")) return "float";
  if (current === "json" || next === "json") return "json";
  return "string";
}

function sqlTypeForKind(kind: MysqlColumnKind, values: unknown[]) {
  if (kind === "json") return "JSON";
  if (kind === "int") return "INT";
  if (kind === "float") return "DECIMAL(10,2)";
  if (kind === "boolean") return "BOOLEAN";
  if (kind === "null") return "TEXT NULL";
  const maxLength = values
    .filter((value): value is string => typeof value === "string")
    .reduce((max, value) => Math.max(max, value.length), 0);
  return maxLength > 255 ? "TEXT" : "VARCHAR(255)";
}

function buildMysqlColumns(records: Record<string, unknown>[], baseTableName: string): MysqlDbColumn[] {
  const keyOrder: string[] = [];
  const valuesByKey = new Map<string, unknown[]>();
  const kindByKey = new Map<string, MysqlColumnKind>();

  records.forEach((record) => {
    Object.entries(record).forEach(([key, value]) => {
      if (!valuesByKey.has(key)) {
        keyOrder.push(key);
        valuesByKey.set(key, []);
      }
      valuesByKey.get(key)?.push(value);
      kindByKey.set(key, mergeColumnKind(kindByKey.get(key), value));
    });
  });

  const recordLooksProduct = records.some((record) => (
    "product_name" in record || "sku" in record || "pricing" in record || "brand" in record
  ));
  const used = new Set<string>(["id", "created_at"]);

  return keyOrder.map((key) => {
    const kind = kindByKey.get(key) ?? "null";
    return {
      originalKey: key,
      columnName: sanitizeDbColumnName(key, used, baseTableName, recordLooksProduct),
      kind,
      sqlType: sqlTypeForKind(kind, valuesByKey.get(key) ?? []),
    };
  });
}

function getMysqlRecordsAndSource(parsed: unknown): {
  records: Record<string, unknown>[];
  sourceArrayKey: string | null;
} {
  if (Array.isArray(parsed)) {
    return { records: parsed.filter(isRecord), sourceArrayKey: null };
  }
  if (!isRecord(parsed)) {
    return { records: [], sourceArrayKey: null };
  }

  const mainArray = getMysqlParserLoopArrayEntry(parsed);
  if (!mainArray) {
    return { records: [parsed], sourceArrayKey: null };
  }

  const [sourceArrayKey, rows] = mainArray;
  const rootFields = Object.fromEntries(
    Object.entries(parsed).filter(([key, value]) => key !== sourceArrayKey && !Array.isArray(value) && !isRecord(value))
  );
  return {
    records: rows.map((row) => ({ ...rootFields, ...row })),
    sourceArrayKey,
  };
}

function getMysqlParserLoopArrayEntry(value: Record<string, unknown>): [string, Record<string, unknown>[]] | null {
  const recordArrayEntries = Object.entries(value).filter(([, item]) => isListOfRecords(item));
  if (recordArrayEntries.length !== 1) return null;

  const [arrayKey, rows] = recordArrayEntries[0] as [string, Record<string, unknown>[]];
  if (arrayKey !== "items" && arrayKey === "variants") return null;

  const hasOnlyScalarRootMetadata = Object.entries(value).every(([key, item]) => (
    key === arrayKey || (!Array.isArray(item) && !isRecord(item))
  ));
  return hasOnlyScalarRootMetadata ? [arrayKey, rows] : null;
}

function pythonSingleQuotedString(value: string) {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function emitMysqlValueExpression(column: MysqlDbColumn) {
  const key = pythonSingleQuotedString(column.originalKey);
  if (column.kind === "json") {
    return `json.dumps(json_dict.get(${key})) if json_dict.get(${key}) else None`;
  }
  return `json_dict.get(${key})`;
}

export function generateMysqlDbCode(source: string, contextName = "data"): MysqlDbGeneration {
  const trimmed = source.trim();
  if (!trimmed) {
    return { sourceJson: "", code: "", error: "No JSON available for DB code generation." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    return { sourceJson: trimmed, code: "", error: `Invalid JSON for DB code generation: ${message}` };
  }

  if (Array.isArray(parsed) && parsed.length === 0) {
    return { sourceJson: trimmed, code: "", error: "Cannot infer schema from empty array." };
  }
  const { records, sourceArrayKey } = getMysqlRecordsAndSource(parsed);

  if (records.length === 0) {
    return { sourceJson: trimmed, code: "", error: "DB code generation needs a JSON object or an array of objects." };
  }

  const baseTableName = sourceArrayKey ? sanitizeOutputKey(sourceArrayKey) : inferBaseTableName(contextName, parsed);
  const dbName = `${baseTableName.replace(/s$/, "")}_db`;
  const columns = buildMysqlColumns(records, baseTableName);
  if (columns.length === 0) {
    return { sourceJson: trimmed, code: "", error: "No top-level JSON fields found for DB columns." };
  }

  const columnDefinitions = columns.map((column) => {
    return `            ${column.columnName} ${column.sqlType},`;
  }).join("\n");
  const insertColumns = columns.map((column, index) => {
    const comma = index < columns.length - 1 ? "," : "";
    return `            ${column.columnName}${comma}`;
  }).join("\n");
  const placeholders = columns.map(() => "%s").join(", ");
  const valueExpressions = columns.map((column, index) => {
    const comma = columns.length === 1 || index < columns.length - 1 ? "," : "";
    return `            ${emitMysqlValueExpression(column)}${comma}`;
  }).join("\n");

  const code = [
    "import mysql.connector",
    "from mysql.connector import Error",
    "import json",
    "from datetime import datetime",
    "",
    "# ============ DATABASE CONFIGURATION ============",
    "DB_CONFIG = {",
    "    'host': 'localhost',",
    "    'user': 'root',",
    "    'password': 'YOUR_DB_PASSWORD',",
    "}",
    "",
    `DB_NAME = 'YOUR_DB_NAME'`,
    `TABLE_NAME = f"${baseTableName}_{datetime.now().strftime('%Y_%m_%d')}"`,
    "# ================================================",
    "",
    "def get_connection():",
    "    return mysql.connector.connect(**DB_CONFIG)",
    "",
    "",
    "def create_database(cursor):",
    "    cursor.execute(f\"CREATE DATABASE IF NOT EXISTS {DB_NAME}\")",
    "    cursor.execute(f\"USE {DB_NAME}\")",
    "    DB_CONFIG['database'] = DB_NAME",
    "    print(f\"Database '{DB_NAME}' created/selected successfully\")",
    "",
    "",
    "def create_table(cursor):",
    "",
    "    try:",
    "        create_table_query = f\"\"\"",
    "        CREATE TABLE IF NOT EXISTS {TABLE_NAME} (",
    "",
    "            id INT AUTO_INCREMENT PRIMARY KEY,",
    "",
    columnDefinitions,
    "",
    "            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    "        )",
    "        \"\"\"",
    "",
    "        cursor.execute(create_table_query)",
    "        print(f\"Table '{TABLE_NAME}' created successfully\")",
    "        cursor.close()",
    "        return True",
    "",
    "    except Error as e:",
    "        print(f\"Error creating table: {e}\")",
    "        return False",
    "    return False",
    "",
    "",
    "def insert_data(json_dict):",
    "",
    "    con = get_connection()",
    "    cursor = con.cursor()",
    "",
    "    try:",
    "        insert_query = f\"\"\"",
    "        INSERT INTO {TABLE_NAME} (",
    insertColumns,
    `        ) VALUES (${placeholders})`,
    "        \"\"\"",
    "",
    "        values = (",
    valueExpressions,
    "        )",
    "",
    "        cursor.execute(insert_query, values)",
    "        con.commit()",
    "",
    "        print(\"Data inserted successfully\")",
    "",
    "        cursor.close()",
    "        con.close()",
    "        return True",
    "",
    "    except Error as e:",
    "        print(f\"Error inserting data: {e}\")",
    "        return None",
    "",
    "",
    "def insert_multiple_data(json_list):",
    "",
    "    if not json_list:",
    "        print(\"No data to insert\")",
    "        return True",
    "",
    "    con = get_connection()",
    "    cursor = con.cursor()",
    "",
    "    try:",
    "        insert_query = f\"\"\"",
    "        INSERT INTO {TABLE_NAME} (",
    insertColumns,
    `        ) VALUES (${placeholders})`,
    "        \"\"\"",
    "",
    "        values_list = []",
    "",
    "        for json_dict in json_list:",
    "            values = (",
    valueExpressions.replace(/^ {12}/gm, "                "),
    "            )",
    "            values_list.append(values)",
    "",
    "        cursor.executemany(insert_query, values_list)",
    "        con.commit()",
    "",
    "        print(f\"Successfully inserted {len(json_list)} records\")",
    "",
    "        return True",
    "",
    "    except Error as e:",
    "        print(f\"Error inserting multiple data: {e}\")",
    "        return None",
    "",
    "    finally:",
    "        cursor.close()",
    "        con.close()",
    "",
  ].join("\n");

  return {
    sourceJson: trimmed,
    code,
    error: null,
  };
}

function sanitizePythonName(value: string) {
  const name = sanitizeOutputKey(value);
  return /^[0-9]/.test(name) ? `item_${name}` : name;
}

interface ParserField {
  outputKey: string;
  path: Array<string | number>;
}

interface ParserArrayGroup {
  prop: string;
  accessPath: Array<string | number>;
  fullPath: Array<string | number>;
  fields: ParserField[];
  children: ParserArrayGroup[];
}

interface ParserLoopGroup {
  prop: string;
  parentPath: Array<string | number>;
  outputKey: string;
  fields: ParserField[];
}

interface JsonLoopFieldPlan {
  outputKey: string;
  path: Array<string | number>;
  loops: SelectedLoopCandidate[];
}

interface JsonLoopOutputPlan {
  loops: SelectedLoopCandidate[];
  outputKey: string;
  fields: JsonLoopFieldPlan[];
}

function singularName(value: string) {
  const sanitized = sanitizePythonName(value);
  if (sanitized.endsWith("ies")) return sanitized.slice(0, -3) + "y";
  if (sanitized.endsWith("s") && sanitized.length > 1) return sanitized.slice(0, -1);
  return `${sanitized}_item`;
}

function normalizeSelectionParts(path: string) {
  return parseJsonPath(path);
}

function findNextArray(parts: Array<string | number>) {
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (typeof parts[index] === "string" && typeof parts[index + 1] === "number") {
      return index;
    }
  }
  return -1;
}

function findLastArray(parts: Array<string | number>) {
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    if (typeof parts[index] === "string" && typeof parts[index + 1] === "number") {
      return index;
    }
  }
  return -1;
}

function pathKey(parts: Array<string | number>) {
  return JSON.stringify(parts);
}

function getOrCreateArrayGroup(groups: ParserArrayGroup[], prop: string, accessPath: Array<string | number>, fullPath = accessPath) {
  const key = pathKey(fullPath);
  let group = groups.find((item) => pathKey(item.fullPath) === key);
  if (!group) {
    group = { prop, accessPath, fullPath, fields: [], children: [] };
    groups.push(group);
  }
  return group;
}

function addSelectionToGroups(groups: ParserArrayGroup[], selection: ParserSelection, parts: Array<string | number>) {
  const arrayIndex = findNextArray(parts);
  if (arrayIndex === -1) return;
  const prop = String(parts[arrayIndex]);
  const accessPath = parts.slice(0, arrayIndex + 1);
  const group = getOrCreateArrayGroup(groups, prop, accessPath, accessPath);
  addSelectionRemainder(group, selection, parts.slice(arrayIndex + 2));
}

function addSelectionRemainder(group: ParserArrayGroup, selection: ParserSelection, remainder: Array<string | number>) {
  const arrayIndex = findNextArray(remainder);
  if (arrayIndex !== -1) {
    const prop = String(remainder[arrayIndex]);
    const accessPath = remainder.slice(0, arrayIndex + 1);
    const child = getOrCreateArrayGroup(group.children, prop, accessPath, [...group.fullPath, ...accessPath]);
    addSelectionRemainder(child, selection, remainder.slice(arrayIndex + 2));
    return;
  }

  const fieldPath = remainder;
  if (fieldPath.length === 0) return;
  if (!group.fields.some((field) => field.outputKey === selection.outputKey && pathKey(field.path) === pathKey(fieldPath))) {
    group.fields.push({ outputKey: selection.outputKey, path: fieldPath });
  }
}

function pythonString(value: string) {
  return JSON.stringify(value);
}

function pythonPathPart(value: string | number) {
  return typeof value === "number" ? String(value) : pythonString(value);
}

function pythonPath(path: Array<string | number>) {
  return `[${path.map(pythonPathPart).join(", ")}]`;
}

function getFromExpression(base: string, path: Array<string | number>) {
  return `_get_value(${base}, ${pythonPath(path)})`;
}

function collectionExpression(base: string, path: Array<string | number>) {
  if (path.length === 0) return base;
  return `_get_value(${base}, ${pythonPath(path)}) or []`;
}

function emitArrayGroup(lines: string[], group: ParserArrayGroup, base: string, indent: string, usedVars: Set<string>) {
  let itemVar = singularName(group.prop);
  if (usedVars.has(itemVar)) {
    let index = 2;
    while (usedVars.has(`${itemVar}_${index}`)) index += 1;
    itemVar = `${itemVar}_${index}`;
  }
  usedVars.add(itemVar);
  const collectionVar = `${itemVar}s`;
  const iterVar = `${collectionVar}_iter`;

  lines.push(`${indent}${collectionVar} = ${collectionExpression(base, group.accessPath)}`);
  lines.push(`${indent}${iterVar} = _iter_items(${collectionVar})`);
  lines.push("");
  lines.push(`${indent}for ${itemVar} in ${iterVar}:`);
  lines.push(`${indent}    if not isinstance(${itemVar}, dict):`);
  lines.push(`${indent}        continue`);

  if (group.fields.length > 0) {
    lines.push(`${indent}    row = {`);
    group.fields.forEach((field, index) => {
      const comma = index < group.fields.length - 1 ? "," : "";
      lines.push(`${indent}        ${pythonString(field.outputKey)}: ${getFromExpression(itemVar, field.path)}${comma}`);
    });
    lines.push(`${indent}    }`);
    lines.push(`${indent}    _append_if_present(results, row)`);
  }

  group.children.forEach((child) => {
    if (group.fields.length > 0) lines.push("");
    emitArrayGroup(lines, child, itemVar, `${indent}    `, usedVars);
  });
}

function uniquePythonVar(base: string, usedVars: Set<string>) {
  let variable = sanitizePythonName(base);
  if (!usedVars.has(variable)) {
    usedVars.add(variable);
    return variable;
  }
  let index = 2;
  while (usedVars.has(`${variable}_${index}`)) index += 1;
  variable = `${variable}_${index}`;
  usedVars.add(variable);
  return variable;
}

function emitArrayGroupRows(lines: string[], group: ParserArrayGroup, base: string, indent: string, usedVars: Set<string>) {
  const itemVar = uniquePythonVar(singularName(group.prop), usedVars);
  const collectionVar = uniquePythonVar(`${itemVar}s`, usedVars);
  const iterVar = uniquePythonVar(`${collectionVar}_iter`, usedVars);
  const rowsVar = uniquePythonVar(`${itemVar}_rows`, usedVars);
  const rowVar = uniquePythonVar(`${itemVar}_row`, usedVars);

  lines.push(`${indent}${collectionVar} = ${collectionExpression(base, group.accessPath)}`);
  lines.push(`${indent}${iterVar} = _iter_items(${collectionVar})`);
  lines.push(`${indent}${rowsVar} = []`);
  lines.push("");
  lines.push(`${indent}for ${itemVar} in ${iterVar}:`);
  lines.push(`${indent}    if not isinstance(${itemVar}, dict):`);
  lines.push(`${indent}        continue`);
  lines.push(`${indent}    ${rowVar} = {}`);
  group.fields.forEach((field) => {
    lines.push(`${indent}    ${rowVar}[${pythonString(field.outputKey)}] = ${getFromExpression(itemVar, field.path)}`);
  });
  group.children.forEach((child) => {
    const childRowsVar = emitArrayGroupRows(lines, child, itemVar, `${indent}    `, usedVars);
    lines.push(`${indent}    ${rowVar}[${pythonString(sanitizeOutputKey(child.prop))}] = ${childRowsVar}`);
  });
  lines.push(`${indent}    ${rowsVar}.append(${rowVar})`);
  return rowsVar;
}

function areLoopsNested(loops: SelectedLoopCandidate[]): boolean {
  if (loops.length <= 1) return true;
  for (let i = 0; i < loops.length - 1; i++) {
    const parent = loops[i];
    const child = loops[i + 1];
    if (child.parentPath.length <= parent.parentPath.length) return false;
    for (let j = 0; j < parent.parentPath.length; j++) {
      if (child.parentPath[j] !== parent.parentPath[j]) return false;
    }
  }
  return true;
}

function emitGroupedNestedJsonLoopPlan(
  lines: string[],
  plan: JsonLoopOutputPlan,
  loopIndex: number,
  baseVar: string,
  indent: string,
  usedVars: Set<string>,
  rowVar: string,
) {
  const loop = plan.loops[loopIndex];
  const previous = loopIndex > 0 ? plan.loops[loopIndex - 1] : undefined;
  const itemVar = loop.varName || uniquePythonVar(loopIndex === plan.loops.length - 1 ? "item" : singularName(loop.label), usedVars);
  loop.varName = itemVar;
  const collectionVar = uniquePythonVar(`${itemVar}s`, usedVars);
  const collectionPath = relativeCollectionPath(loop, previous);

  lines.push(`${indent}${collectionVar} = ${collectionExpression(baseVar, collectionPath)}`);
  lines.push(`${indent}for ${itemVar} in _as_list(${collectionVar}):`);
  lines.push(`${indent}    if not isinstance(${itemVar}, dict):`);
  lines.push(`${indent}        continue`);

  const innerIndent = `${indent}    `;

  if (loopIndex === 0) {
    lines.push(`${innerIndent}${rowVar} = {`);
    plan.fields.forEach((field, index) => {
      const comma = index < plan.fields.length - 1 ? "," : "";
      const fieldLoop = field.loops[field.loops.length - 1];
      const deepestLoop = plan.loops[plan.loops.length - 1];
      const belongsToDeepest = fieldLoop && fieldLoop.parentKey === deepestLoop.parentKey;

      if (!belongsToDeepest) {
        const relativePath = fieldLoop ? relativePathAfterLoop(field.path, fieldLoop) : field.path;
        lines.push(`${innerIndent}    ${pythonString(field.outputKey)}: ${getFromExpression(itemVar, relativePath)}${comma}`);
      } else {
        lines.push(`${innerIndent}    ${pythonString(field.outputKey)}: []${comma}`);
      }
    });
    lines.push(`${innerIndent}}`);
    lines.push("");
  }

  if (loopIndex < plan.loops.length - 1) {
    emitGroupedNestedJsonLoopPlan(lines, plan, loopIndex + 1, itemVar, innerIndent, usedVars, rowVar);
  } else {
    plan.fields.forEach((field) => {
      const fieldLoop = field.loops[field.loops.length - 1];
      if (fieldLoop && fieldLoop.parentKey === loop.parentKey) {
        const relativePath = relativePathAfterLoop(field.path, fieldLoop);
        const valVar = uniquePythonVar(sanitizePythonName(field.outputKey), usedVars);
        lines.push(`${innerIndent}${valVar} = ${getFromExpression(itemVar, relativePath)}`);
        lines.push(`${innerIndent}if ${valVar} is not None:`);
        lines.push(`${innerIndent}    ${rowVar}[${pythonString(field.outputKey)}].append(${valVar})`);
      }
    });
  }

  if (loopIndex === 0) {
    lines.push("");
    lines.push(`${innerIndent}# Clean row and check if it has any non-empty data`);
    lines.push(`${innerIndent}if any(v is not None and (not isinstance(v, list) or len(v) > 0) for v in ${rowVar}.values()):`);
    lines.push(`${innerIndent}    result[${pythonString(plan.outputKey)}].append(${rowVar})`);
  }
}

function emitLoopGroup(lines: string[], group: ParserLoopGroup, usedVars: Set<string>) {
  const collectionVar = uniquePythonVar(sanitizePythonName(group.prop || "items"), usedVars);
  const itemVar = uniquePythonVar("item", usedVars);

  lines.push(`    ${collectionVar} = ${collectionExpression("data", group.parentPath)}`);
  lines.push(`    result[${pythonString(group.outputKey)}] = []`);
  lines.push(`    if isinstance(${collectionVar}, list):`);
  lines.push(`        for ${itemVar} in ${collectionVar}:`);
  lines.push(`            if not isinstance(${itemVar}, dict):`);
  lines.push(`                continue`);
  lines.push(`            row = {`);
  group.fields.forEach((field, index) => {
    const comma = index < group.fields.length - 1 ? "," : "";
    lines.push(`                ${pythonString(field.outputKey)}: ${getFromExpression(itemVar, field.path)}${comma}`);
  });
  lines.push(`            }`);
  lines.push(`            if any(v is not None for v in row.values()):`);
  lines.push(`                result[${pythonString(group.outputKey)}].append(row)`);
  lines.push("");
}

function uniqueGroupOutputKey(baseKey: string, usedKeys: Set<string>) {
  const used = new Set(usedKeys);
  if (!used.has(baseKey)) return baseKey;
  let index = 2;
  while (used.has(`${baseKey}_${index}`)) index += 1;
  return `${baseKey}_${index}`;
}

export function generateParserCode(workspaceName: string, selections: ParserSelection[], source: "response_json" | "script_json" = "response_json") {
  const functionName = `${sanitizePythonName(workspaceName || "request")}_parser`;
  const usedPaths = new Set<string>();
  const deduped: ParserSelection[] = [];
  selections.forEach((selection) => {
    const path = selection.path.trim();
    if (getParserPathWarning(path) || usedPaths.has(path)) return;
    usedPaths.add(path);
    deduped.push({
      path,
      outputKey: uniqueOutputKey(sanitizeOutputKey(selection.outputKey || getOutputKeyFromPath(path)), deduped),
      selectionMode: selection.selectionMode,
      loopPaths: selection.loopPaths,
    });
  });
  const rootFields: ParserField[] = [];
  const loopPlans: JsonLoopFieldPlan[] = [];
  const candidatesByPath = new Map<string, JsonLoopCandidate[]>();
  const loopCounts = new Map<string, number>();

  deduped.forEach((selection) => {
    const candidates = getJsonLoopCandidatesFromParts(normalizeSelectionParts(selection.path));
    candidatesByPath.set(selection.path, candidates);
    const first = candidates[0];
    if (first) loopCounts.set(first.parentKey, (loopCounts.get(first.parentKey) ?? 0) + 1);
  });

  deduped.forEach((selection) => {
    const parts = normalizeSelectionParts(selection.path);
    const candidates = candidatesByPath.get(selection.path) ?? [];
    const selectedLoops = getSelectedJsonLoopCandidates(selection, candidates, loopCounts)
      .map((candidate) => ({ ...candidate, varName: "" }))
      .sort((a, b) => a.sourceIndex - b.sourceIndex);

    if (selectedLoops.length === 0) {
      rootFields.push({ outputKey: selection.outputKey, path: parts });
      return;
    }

    const deepestLoop = selectedLoops[selectedLoops.length - 1];
    if (relativePathAfterLoop(parts, deepestLoop).length === 0) {
      rootFields.push({ outputKey: selection.outputKey, path: parts });
      return;
    }
    loopPlans.push({ outputKey: selection.outputKey, path: parts, loops: selectedLoops });
  });

  const outputChains = new Map<string, SelectedLoopCandidate[]>();
  loopPlans.forEach((field) => {
    outputChains.set(selectedLoopChainKey(field.loops), field.loops);
  });
  Array.from(outputChains.entries()).forEach(([key, loops]) => {
    const hasDeeperChain = Array.from(outputChains.values()).some((candidate) => candidate.length > loops.length && isLoopPrefix(loops, candidate));
    if (hasDeeperChain) outputChains.delete(key);
  });

  const reservedOutputKeys = new Set(rootFields.map((field) => field.outputKey));
  const outputPlans: JsonLoopOutputPlan[] = Array.from(outputChains.values()).map((loops) => {
    const deepest = loops[loops.length - 1];
    const outputKey = uniqueGroupOutputKey(sanitizeOutputKey(deepest?.label || "items"), reservedOutputKeys);
    reservedOutputKeys.add(outputKey);
    return {
      loops,
      outputKey,
      fields: loopPlans.filter((field) => isLoopPrefix(field.loops, loops)),
    };
  });

  const lines = [
    `def ${functionName}(response):`,
    "    try:",
    source === "script_json"
      ? "        data = extract_json_from_script(response.text)"
      : "        data = response if isinstance(response, (dict, list)) else response.json()",
    "    except Exception:",
    "        return {}",
    "",
    "    def _get_value(container, path):",
    "        current = container",
    "        for key in path:",
    "            if isinstance(key, int):",
    "                if not isinstance(current, list) or key < 0 or key >= len(current):",
    "                    return None",
    "                current = current[key]",
    "            else:",
    "                if not isinstance(current, dict):",
    "                    return None",
    "                current = current.get(key)",
    "        return current",
    "",
    "    def _as_list(value):",
    "        if isinstance(value, list):",
    "            return value",
    "        return []",
    "",
    "    def _iter_items(value):",
    "        if isinstance(value, dict):",
    "            return value.values()",
    "        return _as_list(value)",
    "",
    "",
    "    def _clean_dict(row):",
    "        return row",
    "",
  ];

  lines.push("    result = {}");
  lines.push("");

  rootFields.forEach((field) => {
    const variable = sanitizePythonName(field.outputKey);
    lines.push(`    ${variable} = ${getFromExpression("data", field.path)}`);
    lines.push(`    if ${variable} is not None:`);
    lines.push(`        result[${pythonString(field.outputKey)}] = ${variable}`);
    lines.push("");
  });

  outputPlans.forEach((plan) => {
    lines.push(`    result[${pythonString(plan.outputKey)}] = []`);
    if (plan.loops.length > 1 && areLoopsNested(plan.loops)) {
      emitGroupedNestedJsonLoopPlan(lines, plan, 0, "data", "    ", new Set(), "row");
    } else {
      emitNestedJsonLoopPlan(lines, plan, 0, "data", "    ", new Set());
    }
    lines.push("");
  });

  lines.push("    return result");
  lines.push("");
  return lines.join("\n");
}

function getOutputKeyFromHtmlSelector(selector: string) {
  const match = selector.match(/[#.]([A-Za-z0-9_-]+)(?!.*[#.][A-Za-z0-9_-]+)/) || selector.match(/([A-Za-z][A-Za-z0-9_-]*)\s*$/);
  return sanitizeOutputKey(match?.[1] || "value");
}

function xpathToCssFallback(xpath: string) {
  const trimmed = xpath.trim();
  const idMatch = trimmed.match(/^\/\/\*\[@id=(['"])(.*?)\1\]$/);
  if (idMatch) return `#${cssEscape(idMatch[2])}`;
  const attrMatch = trimmed.match(/^\/\/([A-Za-z][\w-]*)\[@([\w:-]+)=(['"])(.*?)\3\]$/);
  if (attrMatch) return `${attrMatch[1]}[${attrMatch[2]}="${attrMatch[4].replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"]`;
  const classMatch = trimmed.match(/^\/\/([A-Za-z][\w-]*)\[contains\(concat\(' ', normalize-space\(@class\), ' '\), ['"] ([^'"]+) ['"]\)\]$/);
  if (classMatch) return `${classMatch[1]}.${cssEscape(classMatch[2])}`;
  const tagMatch = trimmed.match(/^\/\/([A-Za-z][\w-]*)(?:\[\d+\])?$/);
  if (tagMatch) return tagMatch[1];
  const lastTagMatch = trimmed.match(/\/([A-Za-z][\w-]*)(?:\[\d+\])?$/);
  return lastTagMatch?.[1] || "*";
}

function cssToXpathFallback(css: string) {
  const trimmed = css.trim();
  if (trimmed.startsWith("#")) return `//*[@id=${xpathLiteral(trimmed.slice(1))}]`;
  const attrMatch = trimmed.match(/^([A-Za-z][\w-]*)\[([\w:-]+)=["']([^"']+)["']\]$/);
  if (attrMatch) return `//${attrMatch[1]}[@${attrMatch[2]}=${xpathLiteral(attrMatch[3])}]`;
  const classMatch = trimmed.match(/^([A-Za-z][\w-]*)\.([A-Za-z0-9_-]+)$/);
  if (classMatch) return `//${classMatch[1]}[contains(concat(' ', normalize-space(@class), ' '), ${xpathLiteral(` ${classMatch[2]} `)})]`;
  const tagMatch = trimmed.match(/^([A-Za-z][\w-]*)$/);
  return tagMatch ? `//${tagMatch[1]}` : "//*";
}

function getHtmlSelectionKey(selection: ParserSelection) {
  return `${selection.selectorType || "xpath"}:${selection.selector || selection.path}:${selection.extractMode || selection.valueMode || "text"}:${selection.attrName || ""}`;
}

function getHtmlSelectorMappingKey(selection: ParserSelection) {
  const selectorType = selection.selectorType ?? "xpath";
  const selector = String(selection.selector || (selectorType === "css" ? selection.css : selection.xpath) || selection.path || "").trim();
  const parentSelector = String(selection.parentSelector || (selectorType === "css" ? selection.parentCss : selection.parentXpath) || "").trim();
  const relativeSelector = String((selectorType === "css"
    ? selection.relativeCss || selection.relativeSelector
    : selection.relativeXpath || selection.relativeSelector
  ) || "").trim();
  const extractMode = selection.extractMode ?? selection.valueMode ?? "text";
  const attrName = extractMode === "attr" ? String(selection.attrName || "").trim() : "";
  return [selectorType, parentSelector, relativeSelector || selector, extractMode, attrName].join("\u0001");
}

function getDuplicateHtmlSelectorIndexes(selections: ParserSelection[]) {
  const seen = new Set<string>();
  const duplicates = new Set<number>();
  selections.forEach((selection, index) => {
    const key = getHtmlSelectorMappingKey(selection);
    if (seen.has(key)) duplicates.add(index);
    else seen.add(key);
  });
  return duplicates;
}

function optimizeHtmlParserSelections(selections: ParserSelection[]) {
  const used = new Set<string>();
  const optimized: ParserSelection[] = [];

  selections.forEach((selection) => {
    const selectorType = selection.selectorType ?? "xpath";
    let selector = (selection.selector || (selectorType === "css" ? selection.css : selection.xpath) || selection.path || "").trim();
    if (selectorType === "css" && selector.startsWith("//")) selector = xpathToCssFallback(selector);
    const extractMode = selection.extractMode ?? selection.valueMode ?? "text";
    if (!selector) return;
    const normalized: ParserSelection = {
      ...selection,
      path: selector,
      selector,
      xpath: selection.xpath || (selectorType === "xpath" ? selector : ""),
      css: selection.css || (selectorType === "css" ? selector : ""),
      selectorType,
      extractMode,
      valueMode: extractMode,
      attrName: extractMode === "attr" ? selection.attrName?.trim() || "href" : "",
      outputKey: uniqueOutputKey(sanitizeOutputKey(selection.outputKey || getOutputKeyFromHtmlSelector(selector)), optimized),
      parentSelector: selection.parentSelector,
      parentSelectorType: selection.parentSelectorType,
      parentXpath: selection.parentXpath,
      parentCss: selection.parentCss,
      relativeSelector: selection.relativeSelector,
      relativeXpath: selection.relativeXpath,
      relativeCss: selection.relativeCss,
    };
    const key = getHtmlSelectorMappingKey(normalized);
    if (used.has(key)) return;
    used.add(key);
    optimized.push(normalized);
  });

  return optimized;
}

function pythonSelectorCall(variable: string, selection: ParserSelection) {
  const selectorType = selection.selectorType ?? "xpath";
  const selector = selection.selector || (selectorType === "css" ? selection.css : selection.xpath) || selection.path;
  const mode = selection.extractMode ?? selection.valueMode ?? "text";
  if (selectorType === "css") {
    if (mode === "attr") return `${variable}.css(${pythonString(`${selector}::attr(${selection.attrName || "href"})`)}).get()`;
    if (mode === "html") return `${variable}.css(${pythonString(selector)}).get()`;
    return `${variable}.css(${pythonString(`${selector}::text`)}).get()`;
  }
  if (mode === "attr") return `${variable}.xpath(${pythonString(`${selector}/@${selection.attrName || "href"}`)}).get()`;
  if (mode === "html") return `${variable}.xpath(${pythonString(selector)}).get()`;
  return `${variable}.xpath(${pythonString(`${selector}/text()`)}).get()`;
}

function makeRelativeHtmlSelection(selection: ParserSelection, parentSelector: string) {
  const selectorType = selection.selectorType ?? "xpath";
  const relativeSelector = selectorType === "css"
    ? selection.relativeCss || selection.relativeSelector
    : selection.relativeXpath || selection.relativeSelector;
  if (relativeSelector) return { ...selection, selector: relativeSelector, path: relativeSelector };
  const selector = selection.selector || selection.path;
  if (selectorType !== "xpath") return selection;
  if (selector.startsWith(".//") || selector.startsWith("./")) return selection;
  if (selector.startsWith(parentSelector)) {
    const rest = selector.slice(parentSelector.length).replace(/^\/+/, "");
    return { ...selection, selector: rest ? `.//${rest}` : ".", path: rest ? `.//${rest}` : "." };
  }
  return selection;
}

function getRepeatedParentGroups(selections: ParserSelection[]) {
  const groups = new Map<string, ParserSelection[]>();
  selections.forEach((selection) => {
    if (!selection.parentSelector) return;
    const key = `${selection.parentSelectorType || selection.selectorType || "xpath"}:${selection.parentSelector}`;
    groups.set(key, [...(groups.get(key) || []), selection]);
  });
  return Array.from(groups.entries()).filter(([, items]) => items.length > 1);
}

function generateHtmlParserCode(workspaceName: string, selections: ParserSelection[]) {
  const functionName = `${sanitizePythonName(workspaceName || "request")}_parser`;
  const optimized = optimizeHtmlParserSelections(selections);
  const repeatedGroups = getRepeatedParentGroups(optimized);
  const groupedKeys = new Set(repeatedGroups.flatMap(([, items]) => items.map(getHtmlSelectorMappingKey)));
  const rootSelections = optimized.filter((selection) => !groupedKeys.has(getHtmlSelectorMappingKey(selection)));

  const lines = [
    "from parsel import Selector",
    "",
    "",
    `def ${functionName}(response):`,
    "    try:",
    "        html = response.text",
    "    except Exception:",
    "        return []",
    "",
    "    if not html:",
    "        return []",
    "",
    "    selector = Selector(text=html)",
    "",
  ];

  if (repeatedGroups.length === 0) {
    lines.push("    return {");
    rootSelections.forEach((selection, index) => {
      const comma = index < rootSelections.length - 1 ? "," : "";
      lines.push(`        ${pythonString(sanitizeOutputKey(selection.outputKey || getOutputKeyFromHtmlSelector(selection.selector || selection.path)))}: ${pythonSelectorCall("selector", selection)}${comma}`);
    });
    if (rootSelections.length === 0) lines.push("        # Add selectors in the Paths tab.");
    lines.push("    }");
    lines.push("");
    return lines.join("\n");
  }

  lines.push("    results = []");
  lines.push("");
  repeatedGroups.forEach(([key, items], groupIndex) => {
    const [parentType, ...selectorParts] = key.split(":");
    const parentSelector = selectorParts.join(":");
    const parentCall = parentType === "css"
      ? `selector.css(${pythonString(parentSelector)})`
      : `selector.xpath(${pythonString(parentSelector)})`;
    if (groupIndex > 0) lines.push("");
    lines.push(`    items = ${parentCall}`);
    lines.push("");
    lines.push("    for item in items:");
    lines.push("        results.append({");
    items.forEach((selection, index) => {
      const relative = makeRelativeHtmlSelection(selection, parentSelector);
      const comma = index < items.length - 1 ? "," : "";
      lines.push(`            ${pythonString(sanitizeOutputKey(selection.outputKey || getOutputKeyFromHtmlSelector(selection.selector || selection.path)))}: ${pythonSelectorCall("item", relative)}${comma}`);
    });
    lines.push("        })");
  });

  if (rootSelections.length > 0) {
    lines.push("");
    lines.push("    summary = {");
    rootSelections.forEach((selection, index) => {
      const comma = index < rootSelections.length - 1 ? "," : "";
      lines.push(`        ${pythonString(sanitizeOutputKey(selection.outputKey || getOutputKeyFromHtmlSelector(selection.selector || selection.path)))}: ${pythonSelectorCall("selector", selection)}${comma}`);
    });
    lines.push("    }");
    lines.push("    if any(value is not None for value in summary.values()):");
    lines.push("        results.append(summary)");
  }

  lines.push("");
  lines.push("    return results");
  lines.push("");
  return lines.join("\n");
}

function safeGenerateHtmlParserCode(workspaceName: string, selections: ParserSelection[]) {
  try {
    return generateHtmlParserCode(workspaceName, selections);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown parser generation error";
    return [
      "from parsel import Selector",
      "",
      "",
      `def ${sanitizePythonName(workspaceName || "request")}_parser(response):`,
      "    try:",
      "        html = response.text",
      "    except Exception:",
      "        return []",
      "",
      `    return {"error": ${pythonString(`Parser generation failed: ${message}`)}}`,
      "",
    ].join("\n");
  }
}

async function copyToClipboard(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

async function copyText(value: string, label = "Copied") {
  try {
    const copied = await copyToClipboard(value);
    if (copied) {
      toast.success("Copied");
      return;
    }
  } catch {
    // Fall through to the friendly toast below.
  }

  toast.error("Copy failed. Use HTTPS or localhost.");
}

function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat('${value.replace(/'/g, `', "'", '`)}')`;
}

function cssEscape(value: string): string {
  const css = window.CSS as typeof window.CSS & { escape?: (value: string) => string };
  if (css?.escape) return css.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function getXPath(element: Element): string {
  if (element.id) {
    return `//*[@id=${xpathLiteral(element.id)}]`;
  }
  const className = element.getAttribute("class")?.trim().split(/\s+/).find(Boolean);
  if (className) {
    return `//${element.tagName.toLowerCase()}[contains(concat(' ', normalize-space(@class), ' '), ${xpathLiteral(` ${className} `)})]`;
  }
  const dataAttr = Array.from(element.attributes).find((attr) => attr.name.startsWith("data-") && attr.value);
  if (dataAttr) {
    return `//${element.tagName.toLowerCase()}[@${dataAttr.name}=${xpathLiteral(dataAttr.value)}]`;
  }

  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && current.tagName.toLowerCase() !== "html") {
    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === current.tagName) index += 1;
      sibling = sibling.previousElementSibling;
    }
    parts.unshift(`${current.tagName.toLowerCase()}[${index}]`);
    current = current.parentElement;
  }

  return `//${parts.join("/")}`;
}

function getCssSelector(element: Element): string {
  if (element.id) {
    return `#${cssEscape(element.id)}`;
  }

  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && current.tagName.toLowerCase() !== "html") {
    let selector = getCssSelectorPart(current);
    const parent = current.parentElement;
    if (parent) {
      const sameTagSiblings = Array.from(parent.children).filter((child) => child.tagName === current?.tagName);
      if (!selector.includes("#") && !selector.includes("[") && sameTagSiblings.length > 1) {
        selector += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
      }
    }
    parts.unshift(selector);
    if (selector.includes("#") || selector.includes("[")) break;
    current = parent;
  }

  return parts.join(" > ");
}

function getCssSelectorPart(element: Element): string {
  const tag = element.tagName.toLowerCase();
  if (element.id) return `#${cssEscape(element.id)}`;
  const stableAttr = Array.from(element.attributes).find((attr) => (
    attr.value && (
      attr.name.startsWith("data-")
      || ["name", "href", "src", "content", "property", "type", "role", "aria-label"].includes(attr.name)
    )
  ));
  if (stableAttr) return `${tag}[${stableAttr.name}="${stableAttr.value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"]`;
  const className = element.getAttribute("class");
  const firstClass = className?.trim().split(/\s+/).find(Boolean);
  return firstClass ? `${tag}.${cssEscape(firstClass)}` : tag;
}

function getRepeatedParent(element: Element): Element | null {
  let current: Element | null = element.parentElement;
  while (current && current.tagName.toLowerCase() !== "html") {
    const parent = current.parentElement;
    if (!parent) return null;
    const className = current.getAttribute("class")?.trim().split(/\s+/).find(Boolean);
    const matches = Array.from(parent.children).filter((child) => {
      if (child.tagName !== current?.tagName) return false;
      if (!className) return true;
      return child.classList.contains(className);
    });
    if (matches.length > 1) return current;
    current = parent;
  }
  return null;
}

function getRelativeXPath(parent: Element, element: Element) {
  if (parent === element) return ".";
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== parent) {
    let selector = current.tagName.toLowerCase();
    const className = current.getAttribute("class")?.trim().split(/\s+/).find(Boolean);
    if (className) {
      selector += `[contains(concat(' ', normalize-space(@class), ' '), ${xpathLiteral(` ${className} `)})]`;
    }
    parts.unshift(selector);
    current = current.parentElement;
  }
  return parts.length ? `.//${parts.join("/")}` : ".";
}

function getRelativeCssSelector(parent: Element, element: Element) {
  if (parent === element) return ":scope";
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== parent) {
    parts.unshift(getCssSelectorPart(current));
    current = current.parentElement;
  }
  return parts.join(" > ");
}

function getScriptXPathForExtractor(script: Element, scriptIndex: number) {
  const id = script.getAttribute("id");
  if (id) return `//script[@id=${xpathLiteral(id)}]/text()`;
  return `(//script)[${scriptIndex}]/text()`;
}

function getScriptJsonTitle(selection: HtmlElementSelection) {
  const id = selection.attributes.id?.trim();
  if (id) return `${id}.json`;
  const type = selection.attributes.type?.toLowerCase();
  if (type?.includes("ld+json")) return "ld_json.json";
  if (type?.includes("json")) return "script_json.json";
  return "script_json.json";
}

function buildScriptJsonExtractorCode(scriptXPath: string, mode: "json" | "assignment") {
  const base = [
    "from parsel import Selector",
    "import json",
    "",
    "def _parse_json_payload(payload):",
    "    try:",
    "        return json.loads(payload)",
    "    except json.JSONDecodeError:",
    "        return payload",
    "",
  ];

  if (mode === "json") {
    return [
      ...base,
      "def extract_script_json(response):",
      "    selector = Selector(text=response.text)",
      `    raw = selector.xpath(${pythonString(scriptXPath)}).get()`,
      "    if not raw:",
      "        return None",
      "    return _parse_json_payload(raw)",
      "",
    ].join("\n");
  }

  return [
    ...base,
    "def _extract_balanced_json(text):",
    "    start = min([i for i in [text.find('{'), text.find('[')] if i != -1], default=-1)",
    "    if start == -1:",
    "        return ''",
    "    opener = text[start]",
    "    closer = '}' if opener == '{' else ']'",
    "    depth = 0",
    "    in_string = False",
    "    quote = ''",
    "    escaped = False",
    "    for index in range(start, len(text)):",
    "        char = text[index]",
    "        if in_string:",
    "            if escaped:",
    "                escaped = False",
    "            elif char == '\\\\':",
    "                escaped = True",
    "            elif char == quote:",
    "                in_string = False",
    "            continue",
    "        if char in ('\"', \"'\"):",
    "            in_string = True",
    "            quote = char",
    "        elif char == opener:",
    "            depth += 1",
    "        elif char == closer:",
    "            depth -= 1",
    "            if depth == 0:",
    "                return text[start:index + 1]",
    "    return ''",
    "",
    "def extract_script_json(response):",
    "    selector = Selector(text=response.text)",
    `    raw = selector.xpath(${pythonString(scriptXPath)}).get()`,
    "    if not raw:",
    "        return None",
    "    payload = _extract_balanced_json(raw)",
    "    return _parse_json_payload(payload)",
    "",
  ].join("\n");
}

function buildStandaloneScriptJsonExtractorCode(scriptXPath: string, directJson: boolean) {
  return [
    "import argparse",
    "import json",
    "import re",
    "from pathlib import Path",
    "",
    "from parsel import Selector",
    "",
    `SCRIPT_XPATH = ${pythonString(scriptXPath)}`,
    `DIRECT_JSON = ${directJson ? "True" : "False"}`,
    'DEFAULT_OUTPUT = "__OUTPUT_FILE_NAME__"',
    "",
    "def _extract_balanced_json(text, start):",
    "    opener = text[start]",
    "    closer = '}' if opener == '{' else ']'",
    "    depth = 0",
    "    in_string = False",
    "    quote = ''",
    "    escaped = False",
    "    for index in range(start, len(text)):",
    "        char = text[index]",
    "        if in_string:",
    "            if escaped:",
    "                escaped = False",
    "            elif char == '\\\\':",
    "                escaped = True",
    "            elif char == quote:",
    "                in_string = False",
    "            continue",
    "        if char in ('\"', \"'\"):",
    "            in_string = True",
    "            quote = char",
    "        elif char == opener:",
    "            depth += 1",
    "        elif char == closer:",
    "            depth -= 1",
    "            if depth == 0:",
    "                return text[start:index + 1]",
    "    return ''",
    "",
    "def _find_balanced_candidates(text):",
    "    candidates = []",
    "    index = 0",
    "    while index < len(text):",
    "        if text[index] not in '{[':",
    "            index += 1",
    "            continue",
    "        raw = _extract_balanced_json(text, index)",
    "        if raw:",
    "            candidates.append(raw)",
    "            index += len(raw)",
    "        else:",
    "            index += 1",
    "    return candidates",
    "",
    "def _extract_script_payload(script):",
    "    if DIRECT_JSON:",
    "        return script",
    "",
    "    candidates = []",
    "    assignment = re.compile(r'(?:window\\.)?[A-Za-z_$][\\w$]*(?:\\s*=\\s*)|(?:var|let|const)\\s+[A-Za-z_$][\\w$]*\\s*=\\s*')",
    "    for match in assignment.finditer(script):",
    "        start_match = re.search(r'[\\{\\[]', script[match.end():])",
    "        if not start_match:",
    "            continue",
    "        raw = _extract_balanced_json(script, match.end() + start_match.start())",
    "        if not raw:",
    "            continue",
    "        candidates.append(raw)",
    "",
    "    for raw in _find_balanced_candidates(script):",
    "        try:",
    "            json.loads(raw)",
    "            candidates.append(raw)",
    "        except json.JSONDecodeError:",
    "            pass",
    "",
    "    if not candidates:",
    "        raise ValueError('No script JSON found')",
    "    return max(candidates, key=len)",
    "",
    "def extract_json_from_html(html):",
    "    selector = Selector(text=html)",
    "    script = selector.xpath(SCRIPT_XPATH).get()",
    "    if not script:",
    "        raise ValueError(f'Could not find script content at XPath: {SCRIPT_XPATH}')",
    "    return _extract_script_payload(script)",
    "",
    "def main():",
    "    parser = argparse.ArgumentParser(description='Extract the selected script JSON from an HTML response.')",
    "    parser.add_argument('html_file', help='Path to the saved HTML response file')",
    "    parser.add_argument('-o', '--output', default=DEFAULT_OUTPUT, help='Output JSON file path')",
    "    args = parser.parse_args()",
    "",
    "    html = Path(args.html_file).read_text(encoding='utf-8')",
    "    payload = extract_json_from_html(html)",
    "    Path(args.output).write_text(payload, encoding='utf-8')",
    "    try:",
    "        print(json.dumps(json.loads(payload), indent=2, ensure_ascii=False))",
    "    except json.JSONDecodeError:",
    "        print(payload)",
    "",
    "if __name__ == '__main__':",
    "    main()",
    "",
  ].join("\n");
}

function getFullScriptJsonExtraction(rawHtmlFull: string, previewScript: Element): ScriptJsonExtraction | undefined {
  const previewScripts = Array.from(previewScript.ownerDocument.querySelectorAll("script"));
  const scriptIndex = Math.max(1, previewScripts.indexOf(previewScript as HTMLScriptElement) + 1);
  const fullDocument = new DOMParser().parseFromString(rawHtmlFull, "text/html");
  const previewId = previewScript.getAttribute("id");
  const fullScripts = Array.from(fullDocument.querySelectorAll("script"));
  const fullScript = previewId
    ? fullDocument.querySelector(`script#${cssEscape(previewId)}`) ?? fullScripts[scriptIndex - 1]
    : fullScripts[scriptIndex - 1];
  if (!fullScript) return { ok: false, error: "Could not locate full script source" };

  const type = (fullScript.getAttribute("type") || "").toLowerCase();
  const directJson = type.includes("application/json") || type.includes("application/ld+json");
  const extracted = extractJsonFromScriptText(fullScript.textContent || "", directJson);
  if (extracted.ok === false) return { ok: false, error: extracted.error };

  const fullIndex = Math.max(1, fullScripts.indexOf(fullScript as HTMLScriptElement) + 1);
  const scriptXPath = getScriptXPathForExtractor(fullScript, fullIndex);
  return {
    ok: true,
    value: extracted.value,
    json: extracted.raw,
    extractorCode: buildScriptJsonExtractorCode(scriptXPath, extracted.mode),
    standaloneExtractorCode: buildStandaloneScriptJsonExtractorCode(scriptXPath, directJson),
    scriptId: stableHash({ scriptXPath, raw: extracted.raw.slice(0, 2000), length: extracted.raw.length }),
  };

}

export function extractJsonSourcesFromHtml(rawHtmlFull: string): ScriptJsonSource[] {
  const document = new DOMParser().parseFromString(rawHtmlFull, "text/html");
  return Array.from(document.querySelectorAll("script")).flatMap((script, index) => {
    const extraction = getFullScriptJsonExtraction(rawHtmlFull, script);
    if (!extraction || extraction.ok === false) return [];
    const type = script.getAttribute("type");
    const id = script.getAttribute("id");
    const details = [type, id ? `#${id}` : ""].filter(Boolean).join(" - ");
    return [{
      scriptId: extraction.scriptId,
      title: `Script ${index + 1}${details ? ` - ${details}` : ""}`,
      json: extraction.json,
      extractorCode: extraction.extractorCode,
      standaloneExtractorCode: extraction.standaloneExtractorCode,
    }];
  });
}

function getElementAttributes(element: Element): Record<string, string> {
  return Object.fromEntries(
    Array.from(element.attributes)
      .slice(0, 20)
      .map((attr) => [attr.name, attr.value])
  );
}

function createHtmlElementSelection(
  element: Element,
  event: React.MouseEvent,
  container: HTMLDivElement | null,
  rawHtmlFull?: string,
): HtmlElementSelection | null {
  if (!element || !(element instanceof HTMLElement)) return null;

  const rect = container?.getBoundingClientRect();
  const repeatedParent = getRepeatedParent(element);
  const tagName = element.tagName.toLowerCase();
  const xpath = getXPath(element);
  const cssSelector = getCssSelector(element);
  const scriptJson = tagName === "script" && rawHtmlFull
    ? getFullScriptJsonExtraction(rawHtmlFull, element)
    : undefined;

  return {
    tagName,
    xpath,
    cssSelector,
    text: (element.textContent || "").slice(0, 5000),
    attributes: getElementAttributes(element),
    parentXpath: repeatedParent ? getXPath(repeatedParent) : undefined,
    parentCss: repeatedParent ? getCssSelector(repeatedParent) : undefined,
    relativeXpath: repeatedParent ? getRelativeXPath(repeatedParent, element) : undefined,
    relativeCss: repeatedParent ? getRelativeCssSelector(repeatedParent, element) : undefined,
    scriptJson,
    x: rect ? event.clientX - rect.left : 12,
    y: rect ? event.clientY - rect.top : 12,
  };
}

function ResponseBodyViewer({
  source,
  filename,
  contentType,
  selectedPath,
  addedPaths,
  onAddToParser,
  onRemoveFromParser,
  onSelectedPathChange,
  quickAddMode,
}: {
  source: string;
  filename?: string;
  contentType?: string;
  selectedPath?: string | null;
  addedPaths?: Set<string>;
  onAddToParser?: (path: string) => void;
  onRemoveFromParser?: (path: string) => void;
  onSelectedPathChange?: (path: string | null, value?: unknown) => void;
  quickAddMode?: boolean;
}) {
  const mode = useMemo(() => detectResponseMode(source), [source]);

  if (isPythonCodeFile(filename, contentType)) {
    return (
      <CodeEditor
        value={source}
        filename={filename || "response.py"}
        onChange={() => undefined}
        readOnly
        className="absolute inset-0"
      />
    );
  }

  if (mode.kind === "json") {
    return (
      <JsonResponseViewer
        value={mode.value}
        selectedPath={selectedPath}
        addedPaths={addedPaths}
        onAddToParser={onAddToParser}
        onRemoveFromParser={onRemoveFromParser}
        onSelectedPathChange={onSelectedPathChange}
        quickAddMode={quickAddMode}
      />
    );
  }

  if ((contentType || "").toLowerCase().includes("json")) {
    return <pre className="whitespace-pre-wrap px-4 py-3 font-mono text-[12px] leading-[1.6] text-foreground">{source}</pre>;
  }

  return <HtmlResponseViewer html={mode.value} />;
}

function JsonResponseViewer({
  value,
  selectedPath,
  addedPaths,
  onAddToParser,
  onRemoveFromParser,
  onSelectedPathChange,
  quickAddMode,
}: {
  value: unknown;
  selectedPath?: string | null;
  addedPaths?: Set<string>;
  onAddToParser?: (path: string) => void;
  onRemoveFromParser?: (path: string) => void;
  onSelectedPathChange?: (path: string | null, value?: unknown) => void;
  quickAddMode?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const selectedAnchorRef = useRef<HTMLElement | null>(null);
  const [selected, setSelected] = useState<JsonValueSelection | null>(null);
  const [toolbarPosition, setToolbarPosition] = useState<{ left: number; top: number } | null>(null);
  const updateToolbarPosition = useCallback(() => {
    const anchor = selectedAnchorRef.current;
    if (!anchor) {
      setToolbarPosition(null);
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const toolbar = toolbarRef.current;
    const toolbarWidth = toolbar?.offsetWidth || 260;
    const toolbarHeight = toolbar?.offsetHeight || 32;
    const gap = 8;
    let left = rect.right + gap;
    let top = rect.top + rect.height / 2;

    if (left + toolbarWidth > window.innerWidth - gap) {
      left = rect.left - toolbarWidth - gap;
    }

    const minCenterTop = gap + toolbarHeight / 2;
    const maxCenterTop = window.innerHeight - gap - toolbarHeight / 2;
    if (top < minCenterTop) top = minCenterTop;
    if (top > maxCenterTop) top = maxCenterTop;
    if (left < gap) left = gap;

    setToolbarPosition({ left, top });
  }, []);

  useEffect(() => {
    setSelected(null);
    selectedAnchorRef.current = null;
    setToolbarPosition(null);
  }, [value]);

  useEffect(() => {
    if (!selected) return;
    const handleResize = () => updateToolbarPosition();
    window.addEventListener("resize", handleResize);
    updateToolbarPosition();
    return () => window.removeEventListener("resize", handleResize);
  }, [selected, updateToolbarPosition]);

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-0 overflow-auto px-4 py-3 font-mono text-[12px] leading-[1.6] text-foreground"
      onScroll={updateToolbarPosition}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setSelected(null);
          selectedAnchorRef.current = null;
          setToolbarPosition(null);
          onSelectedPathChange?.(null);
        }
      }}
    >
      {quickAddMode ? (
        <div className="mb-3 flex items-center gap-2 rounded-sm border border-primary/30 bg-primary/5 px-3 py-2 text-[11px] text-primary">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
          </span>
          <span>Quick Add Mode Active: Click any JSON key or value to immediately add its path.</span>
        </div>
      ) : !selected && (
        <div className="mb-3 rounded-sm border border-border bg-surface/35 px-3 py-2 text-[11px] text-muted-foreground">
          Select a JSON key or value
        </div>
      )}
      {!quickAddMode && selected && (
        <div
          ref={toolbarRef}
          className="fixed z-50 flex items-center gap-2 rounded-sm border border-border bg-background px-2 py-1 text-[11px] shadow-sm"
          style={{
            left: toolbarPosition?.left ?? 8,
            top: toolbarPosition?.top ?? 8,
            transform: "translateY(-50%)",
          }}
        >
          <span className="max-w-[32ch] truncate text-muted-foreground">{selected.keyName}</span>
          <button
            onClick={() => void copyText(selected.path, "Copied JSON path")}
            className="text-primary hover:text-foreground"
          >
            Copy Path
          </button>
          <button
            onClick={() => void copyText(selected.valueText, "Copied value")}
            className="text-primary hover:text-foreground"
          >
            Copy Value
          </button>
          {(onAddToParser || onRemoveFromParser) && (
            <button
              onClick={() => {
                if (addedPaths?.has(selected.path)) {
                  onRemoveFromParser?.(selected.path);
                  return;
                }
                onAddToParser?.(selected.path);
              }}
              className="text-primary hover:text-foreground"
            >
              {addedPaths?.has(selected.path) ? "Remove Path" : "Add to Path"}
            </button>
          )}
        </div>
      )}
      <JsonTreeNode
        value={value}
        path={[]}
        selectedPath={selectedPath}
        addedPaths={addedPaths}
        onSelect={(path, nodeValue, event) => {
          const nextPath = formatJsonPath(path);
          if (quickAddMode) {
            onAddToParser?.(nextPath);
            setSelected(null);
            setToolbarPosition(null);
            onSelectedPathChange?.(nextPath, nodeValue);
            return;
          }
          const valueText = stringifyJsonValue(nodeValue);
          const key = path.length ? String(path[path.length - 1]) : "root";
          selectedAnchorRef.current = event.currentTarget as HTMLElement;
          setSelected({
            keyName: key,
            path: nextPath,
            valueType: getJsonValueType(nodeValue),
            valueText,
            valuePreview: getJsonValuePreview(nodeValue),
            x: 0,
            y: 0,
          });
          window.requestAnimationFrame(updateToolbarPosition);
          onSelectedPathChange?.(nextPath, nodeValue);
        }}
      />
    </div>
  );
}

export function JsonTreeNode({
  value,
  path,
  name,
  selectedPath,
  addedPaths,
  onSelect,
}: {
  value: unknown;
  path: Array<string | number>;
  name?: string | number;
  selectedPath?: string | null;
  addedPaths?: Set<string>;
  onSelect: (path: Array<string | number>, value: unknown, event: React.MouseEvent) => void;
}) {
  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === "object";
  const entries: Array<[string | number, unknown]> = isArray
    ? (value as unknown[]).map((child, index) => [index, child])
    : isObject
      ? Object.entries(value as Record<string, unknown>)
      : [];
  const displayName = name !== undefined ? String(name) : "";
  const pathString = formatJsonPath(path);
  const isTemporarySelected = selectedPath === pathString;
  const isPermanentlySelected = addedPaths?.has(pathString) ?? false;
  const highlightClass = isPermanentlySelected
    ? "rounded-sm bg-emerald-500/15 outline outline-1 outline-emerald-500/70 outline-offset-1"
    : isTemporarySelected
      ? "rounded-sm outline outline-1 outline-sky-400/80 outline-offset-1"
      : "";

  if (!isObject) {
    const valueClass =
      typeof value === "string"
        ? "text-syntax-string"
        : typeof value === "number"
          ? "text-syntax-number"
          : typeof value === "boolean"
            ? "text-syntax-function"
            : "text-syntax-keyword";
    return (
      <span className={cn("block text-left", highlightClass)}>
        {displayName && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelect(path, value, e);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSelect(path, value, e);
            }}
            className="text-syntax-function hover:text-foreground"
          >
            "{displayName}": 
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelect(path, value, e);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSelect(path, value, e);
          }}
          className={cn(valueClass, "hover:text-foreground")}
        >
          {typeof value === "string" ? JSON.stringify(value) : String(value)}
        </button>
      </span>
    );
  }

  return (
    <div className={cn("text-foreground", highlightClass)}>
      {displayName && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelect(path, value, e);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSelect(path, value, e);
          }}
          className="text-left hover:text-foreground"
        >
          <span className="text-syntax-function">"{displayName}": </span>
        </button>
      )}
      <span className="text-syntax-punct">{isArray ? "[" : "{"}</span>
      <div className="pl-4">
        {entries.map(([key, child], index) => {
          const childPath = [...path, key];
          return (
            <div key={`${key}-${index}`} className="flex items-start gap-1">
              <JsonTreeNode
                value={child}
                path={childPath}
                name={isArray ? undefined : key}
                selectedPath={selectedPath}
                addedPaths={addedPaths}
                onSelect={onSelect}
              />
              {index < entries.length - 1 && <span className="text-syntax-punct">,</span>}
            </div>
          );
        })}
      </div>
      <span className="text-syntax-punct">{isArray ? "]" : "}"}</span>
    </div>
  );
}

function HtmlResponseViewer({
  html,
  addedPaths,
  onAddToParser,
  onRemoveFromParser,
  onOpenScriptJson,
}: {
  html: string;
  addedPaths?: Set<string>;
  onAddToParser?: (selection: ParserSelection) => void;
  onRemoveFromParser?: (selection: ParserSelection) => void;
  onOpenScriptJson?: (source: ScriptJsonSource) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialPreview = useMemo(() => previewSourceLines(html), [html]);
  const [showFullHtml, setShowFullHtml] = useState(!initialPreview.isPreview);
  const visibleHtml = showFullHtml ? html : initialPreview.preview;
  const documentNode = useMemo(() => new DOMParser().parseFromString(visibleHtml, "text/html"), [visibleHtml]);
  const [selectedElement, setSelectedElement] = useState<HtmlElementSelection | null>(null);
  const root = documentNode.documentElement;
  const selectedElementAddedSelector = selectedElement && addedPaths?.has(selectedElement.xpath)
    ? selectedElement.xpath
    : selectedElement && addedPaths?.has(selectedElement.cssSelector)
      ? selectedElement.cssSelector
      : null;
  const selectedElementActionSelector = selectedElement
    ? selectedElementAddedSelector || selectedElement.xpath
    : "";
  const selectedElementActionSelectorType = selectedElementActionSelector === selectedElement?.cssSelector ? "css" : "xpath";
  const selectedElementParserSelection = selectedElement ? {
    path: selectedElementActionSelector,
    selector: selectedElementActionSelector,
    xpath: selectedElement.xpath,
    css: selectedElement.cssSelector,
    selectorType: selectedElementActionSelectorType,
    outputKey: getOutputKeyFromHtmlSelector(selectedElement.cssSelector || selectedElement.xpath),
    extractMode: "text" as const,
    valueMode: "text" as const,
    parentSelector: selectedElement.parentXpath,
    parentSelectorType: selectedElement.parentXpath ? "xpath" as const : undefined,
    parentXpath: selectedElement.parentXpath,
    parentCss: selectedElement.parentCss,
    relativeSelector: selectedElement.relativeXpath,
    relativeXpath: selectedElement.relativeXpath,
    relativeCss: selectedElement.relativeCss,
  } satisfies ParserSelection : null;
  const selectedElementIsAdded = !!selectedElementAddedSelector;
  useEffect(() => {
    setSelectedElement(null);
    setShowFullHtml(!initialPreview.isPreview);
  }, [html, initialPreview.isPreview]);

  return (
    <div
      ref={containerRef}
      className="relative px-4 py-3 font-mono text-[12px] leading-[1.6] text-foreground"
      onClick={(e) => {
        e.preventDefault();
        if (e.target === e.currentTarget) setSelectedElement(null);
      }}
    >
      {!selectedElement && (
        <div className="mb-3 rounded-sm border border-border bg-surface/35 px-3 py-2 text-[11px] text-muted-foreground">
          Select an element to inspect
        </div>
      )}
      {selectedElement && (
        <div
          className="absolute z-20 flex items-center gap-2 rounded-sm border border-border bg-background px-2 py-1 text-[11px] shadow-sm"
          style={{ left: selectedElement.x, top: selectedElement.y + 18 }}
        >
          <span className="max-w-[32ch] truncate text-muted-foreground">{selectedElement.tagName}</span>
          <button
            onClick={() => void copyText(selectedElement.xpath, "Copied XPath")}
            className="text-primary hover:text-foreground"
          >
            Copy XPath
          </button>
          <button
            onClick={() => void copyText(selectedElement.cssSelector, "Copied CSS selector")}
            className="text-primary hover:text-foreground"
          >
            Copy CSS
          </button>
          <button
            onClick={() => void copyText(selectedElement.text, "Copied text")}
            className="text-primary hover:text-foreground"
          >
            Copy Text
          </button>
          {(onAddToParser || onRemoveFromParser) && selectedElementParserSelection && (
            <button
              onClick={() => {
                try {
                  if (selectedElementIsAdded) {
                    onRemoveFromParser?.(selectedElementParserSelection);
                    return;
                  }
                  onAddToParser?.(selectedElementParserSelection);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Could not add selector");
                }
              }}
              className="text-primary hover:text-foreground"
            >
              {selectedElementIsAdded ? "Remove Path" : "Add to Path"}
            </button>
          )}
          {onOpenScriptJson && selectedElement.scriptJson?.ok && (
            <button
              onClick={() => {
                if (selectedElement.scriptJson?.ok) {
                  onOpenScriptJson({
                    scriptId: selectedElement.scriptJson.scriptId,
                    title: getScriptJsonTitle(selectedElement),
                    json: selectedElement.scriptJson.json,
                    extractorCode: selectedElement.scriptJson.extractorCode,
                    standaloneExtractorCode: selectedElement.scriptJson.standaloneExtractorCode,
                  });
                }
              }}
              className="text-primary hover:text-foreground"
            >
              Open Script JSON
            </button>
          )}
        </div>
      )}
      {!showFullHtml && (
        <div className="mb-3 flex items-center justify-between rounded-sm border border-border bg-surface px-3 py-2 text-[11px] text-muted-foreground">
          <span>Preview mode. Full source is kept internally.</span>
          <button
            onClick={() => setShowFullHtml(true)}
            className="text-primary hover:text-foreground"
          >
            Load full HTML
          </button>
        </div>
      )}
      {root ? (
        <>
          {documentNode.doctype && (
            <div className="text-muted-foreground">
              &lt;!DOCTYPE {documentNode.doctype.name}&gt;
            </div>
          )}
          <HtmlTreeNode
            element={root}
            selectedSelector={selectedElement?.xpath ?? null}
            addedPaths={addedPaths}
            onSelect={(element, event) => {
              try {
                const nextSelection = createHtmlElementSelection(element, event, containerRef.current, html);
                if (!nextSelection) return;
                setSelectedElement(nextSelection);
              } catch (error) {
                setSelectedElement(null);
                toast.error(error instanceof Error ? error.message : "Could not inspect element");
              }
            }}
          />
        </>
      ) : (
        <pre className="whitespace-pre-wrap">{html}</pre>
      )}
    </div>
  );
}

function HtmlTreeNode({
  element,
  selectedSelector,
  addedPaths,
  onSelect,
}: {
  element: Element;
  selectedSelector: string | null;
  addedPaths?: Set<string>;
  onSelect: (element: Element, event: React.MouseEvent) => void;
}) {
  const children = Array.from(element.children);
  const attrs = Array.from(element.attributes)
    .slice(0, 3)
    .map((attr) => `${attr.name}="${attr.value}"`)
    .join(" ");
  const directText = Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent?.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 80);
  const xpath = getXPath(element);
  const cssSelector = getCssSelector(element);
  const isSelected = selectedSelector === xpath;
  const isAdded = addedPaths?.has(xpath) || addedPaths?.has(cssSelector);

  return (
    <div className="pl-3">
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onSelect(element, e);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onSelect(element, e);
        }}
        className={cn(
          "block text-left font-mono text-[12px] leading-[1.6] hover:text-foreground",
          isAdded
            ? "rounded-sm bg-emerald-500/15 text-foreground outline outline-1 outline-emerald-500/70 outline-offset-1"
            : isSelected
              ? "rounded-sm text-sky-300 outline outline-1 outline-sky-400/80 outline-offset-1"
              : "text-muted-foreground"
        )}
      >
        <span className="text-syntax-function">&lt;{element.tagName.toLowerCase()}</span>
        {attrs && <span className="text-syntax-string"> {attrs}</span>}
        <span className="text-syntax-function">&gt;</span>
        {directText && <span className="text-foreground"> {directText}</span>}
      </button>
      {children.map((child, index) => (
        <HtmlTreeNode
          key={`${child.tagName}-${index}`}
          element={child}
          selectedSelector={selectedSelector}
          addedPaths={addedPaths}
          onSelect={onSelect}
        />
      ))}
      {children.length > 0 && (
        <div className="text-muted-foreground">&lt;/{element.tagName.toLowerCase()}&gt;</div>
      )}
    </div>
  );
}

function PanelHeader({ label, right }: { label: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex h-8 items-center justify-between border-b border-border bg-surface px-3">
      {typeof label === "string" ? <span className="label-eyebrow">{label}</span> : label}
      {right}
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex h-full min-h-[180px] items-center justify-center px-4 py-8">
      <div className="max-w-sm rounded-sm border border-border bg-surface/35 px-5 py-4 text-center font-mono">
        <div className="text-[12px] font-semibold text-foreground">{title}</div>
        {detail && <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{detail}</div>}
      </div>
    </div>
  );
}

function ParserOutputTable({ value }: { value: unknown }) {
  const rows = getParserOutputTableRows(value);
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 24);

  return (
    <div className="overflow-auto px-4 py-3">
      <table className="w-full border-collapse font-mono text-[11px]">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} className="border border-border bg-surface px-2 py-1.5 text-left font-semibold text-muted-foreground">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((column) => (
                <td key={column} className="max-w-[320px] truncate border border-border px-2 py-1.5 text-foreground" title={stringifyJsonValue(row[column])}>
                  {stringifyJsonValue(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InspectorRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="break-words font-mono text-[11px] leading-5 text-foreground">{children}</div>
    </div>
  );
}

function InspectorActionButton({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-7 items-center justify-center rounded-sm border border-border bg-background/40 px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border-strong hover:bg-surface-elevated hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
  );
}

function InspectorPanel({
  title,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  if (collapsed) {
    return (
      <aside className="flex w-9 shrink-0 items-start justify-center border-l border-border bg-surface/40 py-2">
        <button
          onClick={onToggle}
          className="flex h-7 w-7 items-center justify-center rounded-sm border border-border bg-background/40 text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
          title="Show inspector"
          aria-label="Show inspector"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-surface/40">
      <div className="flex h-9 items-center justify-between border-b border-border px-3">
        <span className="font-mono text-[11px] font-semibold text-foreground">{title}</span>
        <button
          onClick={onToggle}
          className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground"
          title="Collapse inspector"
          aria-label="Collapse inspector"
        >
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {children}
      </div>
    </aside>
  );
}

function AutoTextarea({
  value,
  onChange,
  placeholder,
  hasError,
  onPasteCollapse,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hasError?: boolean;
  onPasteCollapse?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.max(el.scrollHeight, 48) + "px";
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onPaste={(e) => {
        const pasted = e.clipboardData.getData("text") || "";
        if (pasted.trim().length > 0 && onPasteCollapse) onPasteCollapse();
      }}
      onClick={(e) => e.stopPropagation()}
      placeholder={placeholder}
      rows={2}
      className={cn(
        "block w-full resize-none bg-transparent px-3 pb-2 pt-1 font-mono text-[12px] leading-[1.6] text-foreground caret-primary outline-none placeholder:text-muted-foreground/50",
        hasError && "text-destructive"
      )}
    />
  );
}

function formatRelativeSeconds(date: Date) {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr ago`;
}

function MetaRow({ tab, blocks, names, actions, dirty = false, saveStatus }: { tab: OutputTab; blocks: SnippetBlock[]; names: string[]; actions?: ReactNode; dirty?: boolean; saveStatus?: string }) {
  if (tab.kind === "merged") {
    const valid = blocks.filter((b) => b.raw.trim() && !b.parsed.error).length;
    return (
      <div className="flex min-h-9 items-center gap-2 border-b border-border bg-background px-4 py-1.5 font-mono text-[12px]">
        <span className="rounded-sm border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">MULTI</span>
        <span className="text-muted-foreground">{valid} snippet{valid === 1 ? "" : "s"}</span>
        <span className="text-border-strong">|</span>
        <span className="text-foreground">Combined Script{dirty ? " *" : ""}</span>
        {saveStatus && <span className="ml-auto text-[11px] text-muted-foreground">{saveStatus}</span>}
        {actions}
      </div>
    );
  }
  if (tab.kind === "parser") {
    return (
      <div className="flex min-h-9 items-center gap-2 border-b border-border bg-background px-4 py-1.5 font-mono text-[12px]">
        <span className="rounded-sm border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">PARSER</span>
        <span className="text-muted-foreground">Auto-generated{dirty ? " *" : ""}</span>
        {saveStatus && <span className="ml-auto text-[11px] text-muted-foreground">{saveStatus}</span>}
        {actions}
      </div>
    );
  }
  const idx = tab.reqIdx ?? 0;
  const parsed = blocks[idx]?.parsed;
  if (!parsed || parsed.error) {
    return (
      <div className="flex min-h-9 items-center gap-2 border-b border-border bg-background px-4 py-1.5 font-mono text-[12px]">
        <span className="rounded-sm border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">REQUEST</span>
        <span className="text-primary">{names[idx] ?? tab.filename}{dirty ? " *" : ""}</span>
        {saveStatus && <span className="ml-auto text-[11px] text-muted-foreground">{saveStatus}</span>}
        {actions}
      </div>
    );
  }
  const m = parsed.method.toUpperCase();
  const methodColor: Record<string, string> = {
    GET: "text-syntax-function",
    POST: "text-primary",
    PUT: "text-syntax-number",
    DELETE: "text-destructive",
    PATCH: "text-syntax-string",
    HEAD: "text-muted-foreground",
    OPTIONS: "text-muted-foreground",
  };
  return (
    <div className="flex min-h-9 items-center gap-2 border-b border-border bg-background px-4 py-1.5 font-mono text-[12px]">
      <span className={cn("rounded-sm border border-border bg-surface px-1.5 py-0.5 text-[10px] font-semibold", methodColor[m] || "text-foreground")}>{m}</span>
      <span className="truncate text-foreground">{parsed.domain}</span>
      <span className="text-border-strong">|</span>
      <span className="text-muted-foreground">{parsed.dataType || "None"}</span>
      <span className="text-border-strong">|</span>
      <span className="truncate text-primary">{names[idx]}{dirty ? " *" : ""}</span>
      {saveStatus && <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">{saveStatus}</span>}
      {actions}
    </div>
  );
}

function SegToggle({
  value,
  options,
  onChange,
  disabled = [],
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  disabled?: string[];
}) {
  return (
    <div className="flex overflow-hidden rounded-sm border border-border">
      {options.map((opt) => {
        const isActive = opt === value;
        const isDisabled = disabled.includes(opt);
        return (
          <button
            key={opt}
            disabled={isDisabled}
            onClick={() => onChange(opt)}
            className={cn(
              "px-2 py-0.5 text-[11px] font-mono transition-colors",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-surface-elevated hover:text-foreground",
              isDisabled && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground"
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}


