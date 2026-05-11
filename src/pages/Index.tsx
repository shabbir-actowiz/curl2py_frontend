import { Component, type ErrorInfo, type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Check, Copy, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, AlertCircle, Download, X, PanelLeft, FileCode, Save, FolderOpen, LogIn, Plus, Trash2, GripVertical, Upload, LogOut, Pencil, Moon, Sun, Play, Loader2 } from "lucide-react";
import JSZip from "jszip";
import { toast } from "sonner";
import favicon from "/favicon-32x32.png";
import { cn } from "@/lib/utils";
import {
  parseCurl,
  type ParsedCurl,
} from "@/lib/curl-to-python";
import { HighlightedPython } from "@/lib/python-highlight";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  convertWithBackend,
  createIssue,
  deleteConversionCollection,
  deleteConversionSnippet,
  extractApiErrorMessage,
  getUserWorkspace,
  renameConversionCollection,
  runParserWithBackend,
  runWorkspaceWithBackend,
  saveUserWorkspace,
} from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";

type Client = "requests" | "httpx";

interface Snippet {
  id: string;
  name: string;
  raw: string;
  collapsed?: boolean;
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
type ParserPageTab = "source" | "paths" | "parser" | "output";
type ParserOutputView = "json" | "table";

interface ParserSelection {
  id?: string;
  path: string;
  outputKey: string;
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
}

type ScriptJsonExtraction = {
  ok: true;
  value: unknown;
  json: string;
  extractorCode: string;
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

const SESSION_KEY = "curl2py:session:v2";
const THEME_KEY = "curl2py:theme:v1";
const SCRIPT_JSON_STORAGE_PREFIX = "curl2py:script-json:";

const SAMPLE_SNIPPETS: Snippet[] = [];

const BACKEND_PLACEHOLDER = "# Connect to the backend and sync to generate Python code\n";
const DEFAULT_PROXY_CONFIG: ProxyConfig = { enabled: false, url: "" };
const toolbarButtonClass = "inline-flex h-7 items-center justify-center gap-1.5 rounded-sm border px-2.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45";
const quietToolbarButtonClass = `${toolbarButtonClass} border-border bg-background/40 text-muted-foreground hover:border-border-strong hover:bg-surface-elevated hover:text-foreground`;
const primaryToolbarButtonClass = `${toolbarButtonClass} border-primary/60 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary`;
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
    let base = (s.name || "").trim() || `request_${i + 1}`;
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
  const [issueType, setIssueType] = useState("Workspace");
  const [issueDescription, setIssueDescription] = useState("");
  const [issueEmail, setIssueEmail] = useState("");
  const [issueFiles, setIssueFiles] = useState<File[]>([]);
  const [isSubmittingIssue, setIsSubmittingIssue] = useState(false);
  const [submittedIssueId, setSubmittedIssueId] = useState("");
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>("");
  const [activeWorkspaceFile, setActiveWorkspaceFile] = useState<WorkspaceFile>("request.py");
  const [activeInputTab, setActiveInputTab] = useState<InputPanelTab>("input");
  const [activePanelTab, setActivePanelTab] = useState<WorkspacePanelTab>("code");
  const [parserBuilderMode, setParserBuilderMode] = useState<ParserBuilderMode>("json");
  const [parserPageTab, setParserPageTab] = useState<ParserPageTab>("source");
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

  const { user, accessToken, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const parserRouteParams = useParams<{ collectionId?: string; snippetId?: string; scriptId?: string }>();
  const isParserRoute = location.pathname.startsWith("/parser");

  const outputRef = useRef<HTMLDivElement>(null);
  const snippetRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const focusNameOnMountId = useRef<string | null>(null);
  const nameInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const mainRef = useRef<HTMLDivElement>(null);
  const syncAbortRef = useRef<AbortController | null>(null);
  const inFlightSyncKeyRef = useRef<string | null>(null);
  const lastSuccessfulSyncKeyRef = useRef<string | null>(null);
  const lastSyncedSnippetHashesRef = useRef<Record<string, string>>({});

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

  const setWorkspaceArtifacts = (updater: Record<string, WorkspaceArtifact> | ((prev: Record<string, WorkspaceArtifact>) => Record<string, WorkspaceArtifact>)) => {
    updateActiveCollection((collection) => {
      const nextArtifacts = typeof updater === "function"
        ? (updater as (prev: Record<string, WorkspaceArtifact>) => Record<string, WorkspaceArtifact>)(collection.workspaceArtifacts)
        : updater;
      return { ...collection, workspaceArtifacts: nextArtifacts };
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

  const errorCount = blocks.filter((b) => b.parsed.error || !b.raw.trim()).length;
  const validBlocks = blocks.filter((b) => b.raw.trim() && !b.parsed.error);

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
      hasError: !b.raw.trim() || !!b.parsed.error,
    }));

    if (mergeMode && validBlocks.length > 0) {
      tabs.push({
        id: "merged",
        kind: "merged",
        filename: "generated_script.py",
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
  const activeWorkspaceArtifact = activeWorkspaceId ? workspaceArtifacts[activeWorkspaceId] : undefined;
  const activeRequestCode = activeTab?.code ?? "";
  const activeCodeFilename = activeTab?.filename || "-";
  const activeCodeContent = activeRequestCode;
  const panelCodeFilename = activeTab?.kind === "merged" || activeTab?.kind === "parser"
    ? activeTab.filename
    : activeCodeFilename;
  const panelCodeContent = activeTab?.kind === "merged" || activeTab?.kind === "parser"
    ? activeTab.code
    : activeCodeContent;
  const activeMetaJson = activeWorkspaceArtifact?.metaJson;
  const activeLogsTxt = activeWorkspaceArtifact?.logsTxt ?? "";
  const activeWorkspaceDisplayName = activeWorkspaceName || "request";
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
  const parserWorkspaceId = parserRouteParams.snippetId || activeResponseTab?.workspaceId || activeWorkspaceId;
  const parserWorkspaceIndex = parserSnippets.findIndex((snippet) => snippet.id === parserWorkspaceId);
  const parserWorkspaceName = parserWorkspaceIndex >= 0
    ? parserNames[parserWorkspaceIndex]
    : activeResponseWorkspaceName || activeWorkspaceDisplayName || "request";
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
  const currentJsonLoop = useMemo(() => getPrimaryJsonLoopContext(parserSelections), [parserSelections]);
  const currentHtmlLoop = useMemo(() => getPrimaryHtmlLoopContext(htmlParserSelections), [htmlParserSelections]);
  const parserLoopCount = parserBuilderMode === "html"
    ? getHtmlLoopContexts(htmlParserSelections).length
    : getJsonLoopContexts(parserSelections).length;
  const parserCode = parserBuilderMode === "html"
    ? safeGenerateHtmlParserCode(parserWorkspaceName, htmlParserSelections)
    : parserSelections.length > 0
      ? generateParserCode(parserWorkspaceName, parserSelections, parserUsesScriptJson ? "script_json" : "response_json")
      : parserArtifact?.parserCode ?? buildParserStub(parserWorkspaceName);

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
      return current === "paths" || current === "parser" || current === "output" ? current : "source";
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
        client,
        isAsync,
        mergeMode,
        shouldPersist: !!(user && accessToken),
        proxyConfig,
      }),
    ])
  ) as Record<string, string>, [activeCollection.id, snippets, effectiveNames, client, isAsync, mergeMode, user, accessToken, proxyConfig]);
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
        if (workspace.collections && Object.keys(workspace.collections).length > 0) {
          const loadedCollections = normalizeCollections(workspace.collections as Record<string, CollectionState>);
          setCollections(loadedCollections);
          if (workspace.activeCollectionId && loadedCollections[workspace.activeCollectionId]) {
            setActiveCollectionId(workspace.activeCollectionId);
          }
          setOpenResponseTabs((workspace.openResponseTabs as unknown as ResponseTab[]) || []);
          setActiveResponseTabId(workspace.activeResponseTabId || null);
        }
        if (workspace.theme === "light" || workspace.theme === "dark") {
          setTheme(workspace.theme);
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
      void saveUserWorkspace({
        collections: sanitizeCollectionsForStorage(collections),
        activeCollectionId,
        theme,
        openResponseTabs: openResponseTabs as unknown as Record<string, unknown>[],
        activeResponseTabId,
      }, accessToken).catch(() => {
        setStatusKind("error");
        setStatusMsg("Could not save workspace");
      });
    }, 800);
    return () => window.clearTimeout(timeout);
  }, [user, accessToken, hasLoadedRemoteWorkspace, collections, activeCollectionId, theme, openResponseTabs, activeResponseTabId]);

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

    if (file === "parser.py") {
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
    const parsed = blocks[workspaceIndex]?.parsed;

    setActiveWorkspaceId(workspaceId);
    setActiveWorkspaceFile("request.py");
    setExpandedWorkspaceIds((prev) => new Set(prev).add(workspaceId));
    setStatusKind("info");
    setStatusMsg(`Running ${workspaceName}...`);

    if (!validateProxyConfig()) {
      return;
    }

    if (!requestSnippet || !requestSnippet.raw.trim() || parsed?.error) {
      const errorMessage = parsed?.error || "Add a curl command before running";
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
      const next = [...prev, { id, name, raw: "" }];
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
    <div className="ml-auto flex items-center gap-1">
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
    const parserCode = nextSelections.length > 0
      ? generateParserCode(workspaceName, nextSelections, scriptJsonParserByWorkspace[workspaceId] ? "script_json" : "response_json")
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

  const addSelectedPathToParser = () => {
    const selectedPath = selectedParserPath;
    const targetCollection = isParserRoute ? parserCollection : activeCollection;
    const targetNames = targetCollection.id === activeCollection.id ? effectiveNames : resolveEffectiveNames(targetCollection.snippets);
    const workspaceId = isParserRoute ? parserWorkspaceId : activeResponseTab?.workspaceId || activeWorkspaceId;
    const requestKey = isParserRoute ? activeParserRequestKey : workspaceId ? `${targetCollection.id}:${workspaceId}` : "";

    console.debug("selectedPath before add", selectedPath);
    console.debug("activeRequestKey", requestKey);

    if (!selectedPath || !workspaceId || !requestKey) return;
    const workspaceIndex = targetCollection.snippets.findIndex((snippet) => snippet.id === workspaceId);
    if (workspaceIndex === -1) return;
    const workspaceName = targetNames[workspaceIndex] ?? targetCollection.snippets[workspaceIndex].name ?? `request_${workspaceIndex + 1}`;

    setParserSelectionsByRequest((prev) => {
      const currentSelections = prev[requestKey] ?? (isScriptJsonRoute ? [] : targetCollection.workspaceArtifacts?.[workspaceId]?.parserSelections ?? []);
      if (currentSelections.some((selection) => selection.path === selectedPath)) {
        toast.info("Path already added");
        console.debug("new parser selections", currentSelections);
        return prev;
      }

      const nextSelections = [
        ...currentSelections,
        {
          id: newId(),
          path: selectedPath,
          outputKey: uniqueOutputKey(getOutputKeyFromPath(selectedPath), currentSelections),
        },
      ];
      console.debug("new parser selections", nextSelections);
      if (!isScriptJsonRoute) writeParserSelectionsToArtifact(targetCollection.id, workspaceId, workspaceName, nextSelections);
      toast.success("Path added");
      return {
        ...prev,
        [requestKey]: nextSelections,
      };
    });

    setActiveWorkspaceId(workspaceId);
    setActiveWorkspaceFile("parser.py");
  };

  const addPathToParser = (path: string) => {
    const targetCollection = isParserRoute ? parserCollection : activeCollection;
    const targetNames = targetCollection.id === activeCollection.id ? effectiveNames : resolveEffectiveNames(targetCollection.snippets);
    const workspaceId = isParserRoute ? parserWorkspaceId : activeResponseTab?.workspaceId || activeWorkspaceId;
    if (!workspaceId) return;
    const workspaceIndex = targetCollection.snippets.findIndex((snippet) => snippet.id === workspaceId);
    if (workspaceIndex === -1) return;
    const workspaceName = targetNames[workspaceIndex] ?? targetCollection.snippets[workspaceIndex].name ?? `request_${workspaceIndex + 1}`;
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
      if (!isGeneratedParser && !window.confirm("Replace custom parser.py with generated parser code?")) {
        return prev;
      }

      const outputKey = uniqueOutputKey(sanitizeOutputKey(lastKey), existingSelections);
      const parserSelections = [...existingSelections, { path, outputKey }];
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

  const updateParserSelectionsForWorkspace = (
    workspaceId: string,
    updater: ParserSelection[] | ((prev: ParserSelection[]) => ParserSelection[]),
  ) => {
    const targetCollection = isParserRoute ? parserCollection : activeCollection;
    const targetNames = targetCollection.id === activeCollection.id ? effectiveNames : resolveEffectiveNames(targetCollection.snippets);
    const workspaceIndex = targetCollection.snippets.findIndex((snippet) => snippet.id === workspaceId);
    if (workspaceIndex === -1) return;
    const workspaceName = targetNames[workspaceIndex] ?? targetCollection.snippets[workspaceIndex].name ?? `request_${workspaceIndex + 1}`;
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
    if (!parserWorkspaceId) return;
    try {
      const parsed = JSON.parse(parserJsonDraft);
      const pretty = JSON.stringify(parsed, null, 2);
      if (isScriptJsonRoute && scriptJsonSourceKey && activeScriptJsonSource) {
        setScriptJsonSourcesByRequest((prev) => ({
          ...prev,
          [scriptJsonSourceKey]: {
            ...activeScriptJsonSource,
            json: pretty,
          },
        }));
        setParserJsonDraft(pretty);
        setIsEditingParserJson(false);
        toast.success("JSON saved");
        return;
      }
      setManualParserJsonByWorkspace((prev) => ({
        ...prev,
        [parserWorkspaceId]: pretty,
      }));
      setParserJsonDraft(pretty);
      setIsEditingParserJson(false);
      toast.success("JSON saved");
    } catch {
      toast.error("Invalid JSON. Fix the syntax and try again.");
    }
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
    if (workspaceIndex === -1) return;
    const workspaceName = targetNames[workspaceIndex] ?? targetCollection.snippets[workspaceIndex].name ?? `request_${workspaceIndex + 1}`;
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
      if (workspaceIndex === -1) return;
      const workspaceName = targetNames[workspaceIndex] ?? targetCollection.snippets[workspaceIndex].name ?? `request_${workspaceIndex + 1}`;
      let artifact = targetCollection.workspaceArtifacts[workspaceId];
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

  const handleSubmitIssue = async (event: FormEvent) => {
    event.preventDefault();
    if (!issueDescription.trim()) {
      toast.error("Issue description is required");
      return;
    }
    if (!issueEmail.trim()) {
      toast.error("Your email is required");
      return;
    }

    const formData = new FormData();
    formData.append("issue_type", issueType.trim() || "Other");
    formData.append("description", issueDescription.trim());
    formData.append("email", issueEmail.trim());
    issueFiles.forEach((file) => formData.append("files", file));

    try {
      setIsSubmittingIssue(true);
      const response = await createIssue(formData);
      setSubmittedIssueId(response.issue_id);
      toast.success("Issue submitted");
    } catch (error) {
      toast.error(extractApiErrorMessage(error));
    } finally {
      setIsSubmittingIssue(false);
    }
  };

  const handleDownloadAll = async () => {
    if (visibleTabs.length === 0) return;
    const zip = new JSZip();
    for (const t of visibleTabs) zip.file(t.filename, t.code);
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
    setStatusMsg(`Downloaded ${visibleTabs.length} file${visibleTabs.length === 1 ? "" : "s"} as ZIP`);
  };

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
        const migratedSnippets = data.snippets.map((s: any, index: number) => normalizeSnippet(s, `request_${index + 1}`));
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
      .filter(({ block }) => block.raw.trim().length > 0 && !block.parsed.error);
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

    syncAbortRef.current?.abort();
    const abortController = new AbortController();
    syncAbortRef.current = abortController;
    inFlightSyncKeyRef.current = currentSyncKey;

    try {
      setIsSyncingBackend(true);
      const singleResults = await Promise.all(
        changedConversionTargets.map(async ({ block, index }) => {
          const response = await convertWithBackend(
            {
              collection_id: activeCollection.id,
              collection_name: activeCollection.name,
              library: client,
              curl: {
                curl: block.raw,
                function_name: effectiveNames[index],
                snippet_id: block.id,
                name: effectiveNames[index],
              },
              proxy: proxyConfig,
            },
            accessToken || undefined,
            abortController.signal,
          );

          if (!response.success) {
            throw new Error(response.error || response.error_type || `Backend conversion failed for ${effectiveNames[index]}`);
          }

          return {
            id: block.id,
            code: response.python_code ?? response.request_script ?? "",
            functionName: response.function_name ?? effectiveNames[index],
            hash: snippetSyncHashes[block.id],
          };
        })
      );

      const nextOutputs: Record<string, string> = {};
      singleResults.forEach((entry) => {
        nextOutputs[entry.id] = entry.code || "# Backend conversion returned no code\n";
        lastSyncedSnippetHashesRef.current[entry.id] = entry.hash;
      });
      setBackendOutputs((prev) => ({ ...prev, ...nextOutputs }));

      if (mergeMode) {
        const batchResponse = await convertWithBackend(
          {
            collection_id: activeCollection.id,
            collection_name: activeCollection.name,
            library: client,
            persist: false,
            commands: conversionTargets.map(({ block, index }) => ({
              curl: block.raw,
              function_name: effectiveNames[index],
              snippet_id: block.id,
              name: effectiveNames[index],
            })),
            proxy: proxyConfig,
          },
          accessToken || undefined,
          abortController.signal,
        );

        if (!batchResponse.success) {
          throw new Error(batchResponse.error || batchResponse.error_type || "Backend batch conversion failed");
        }

        setBackendMergedOutput(batchResponse.request_script ?? batchResponse.python_code ?? "# Backend conversion returned no code\n");
        setBackendParserOutput(batchResponse.parser_script ?? "");
      } else {
        setBackendMergedOutput(null);
        setBackendParserOutput(null);
      }

      const label = `${singleResults.length} changed snippet${singleResults.length === 1 ? "" : "s"}`;
      const actionLabel = user && accessToken ? "Synced to backend" : "Converted";
      lastSuccessfulSyncKeyRef.current = currentSyncKey;
      setStatusKind("success");
      setStatusMsg(`${actionLabel} - ${label}`);
      if (!silent) {
        toast.success(user && accessToken ? "Generated code via backend" : "Converted curl");
      }
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") {
        return;
      }
      const message = getFriendlyErrorMessage(error);
      const statusMessage = message.includes("Could not save conversion") || message.includes("Missing collection")
        ? "Save failed"
        : message;
      setStatusKind("error");
      setStatusMsg(statusMessage);
      toast.error(message);
    } finally {
      if (inFlightSyncKeyRef.current === currentSyncKey) {
        inFlightSyncKeyRef.current = null;
      }
      if (syncAbortRef.current === abortController) {
        syncAbortRef.current = null;
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
  }, [syncKey, snippets, user, accessToken]);

  if (isParserRoute) {
    const canUseParser = !!parserWorkspaceId;
    const hasResponse = !!parserResponseJson;
    const hasHtml = !!parserResponseHtml;
    const canShowJsonParser = hasResponse && parserResponseIsJson;
    const parserJsonEditorVisible = parserBuilderMode === "json" && parserPageTab === "source" && isEditingParserJson;
    const parserHtmlEditorVisible = parserBuilderMode === "html" && parserPageTab === "source" && isEditingParserHtml;
    const parserTabs: ParserPageTab[] = ["source", "paths", "parser", "output"];
    const currentLoop = parserBuilderMode === "html" ? currentHtmlLoop : currentJsonLoop;
    const canShowTableOutput = isListOfRecords(activeParserRun?.output);

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
                {parserJsonEditorVisible ? (
                  <button
                    onClick={saveParserJson}
                    disabled={!canUseParser || (isScriptJsonRoute && !activeScriptJsonSource)}
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
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
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
                  onSelectedPathChange={handleParserPathSelect}
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
                      <span className="truncate">Current loop: {currentLoop}</span>
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
                      const warning = getParserPathWarning(selection.path);
                      return (
                        <div key={`${selection.path}-${index}`} className="grid gap-1 md:grid-cols-[minmax(0,1fr)_220px_28px] md:items-start">
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
                      <span className="truncate">Current loop: {currentLoop}</span>
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
          ) : (
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
                  <span className="text-muted-foreground">{activeParserRun?.itemCount ?? 0} item{(activeParserRun?.itemCount ?? 0) === 1 ? "" : "s"}</span>
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
          )}
          </ParserInspectorErrorBoundary>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* TOP BAR */}
      <header className="flex h-12 items-center justify-between border-b border-border bg-surface/70 px-4">
        <div className="flex items-center gap-0">
          <button
            onClick={() => setSidebarOpen((s) => !s)}
            className="mr-1 flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground"
            title={sidebarOpen ? "Hide collection" : "Show collection"}
            aria-label="Toggle collection"
          >
            <PanelLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <img src={favicon} alt="logo" className="mr-1 h-6 w-6" />
          <h1 className="m-0 p-0 text-[15px] font-semibold leading-none tracking-tight">
            <span className="text-primary">curl</span>
            <span className="text-muted-foreground">2</span>
            <span className="text-foreground">py</span>
          </h1>
          
        </div>

        <div className="flex items-center gap-2">

          <button
            onClick={() => setTheme((value) => value === "dark" ? "light" : "dark")}
            className={quietToolbarButtonClass}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun className="h-3 w-3" strokeWidth={2} /> : <Moon className="h-3 w-3" strokeWidth={2} />}
            {theme === "dark" ? "Light" : "Dark"}
          </button>

          <button
            onClick={() => setMergeMode((s) => !s)}
            className={cn(
              toolbarButtonClass,
              mergeMode
                ? "border-primary/60 bg-primary/10 text-primary hover:bg-primary/15"
                : "border-border bg-background/40 text-muted-foreground hover:border-border-strong hover:bg-surface-elevated hover:text-foreground"
            )}
            title="Combine all requests into a single script + parser stub"
          >
            <FileCode className="h-3 w-3" strokeWidth={2} />
            Merge Scripts
          </button>

          {/* <button
            onClick={() => setOptionsOpen((s) => !s)}
            className={cn(
              "flex items-center gap-1.5 rounded-sm border border-border bg-transparent px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground",
              optionsOpen && "border-border-strong text-foreground"
            )}
            aria-expanded={optionsOpen}
          > */}
            {/* <span>{client}{isAsync ? " - async" : ""}</span>
            <ChevronDown
              className={cn("h-3 w-3 transition-transform", optionsOpen && "rotate-180")}
              strokeWidth={2}
            />
          </button> */}

          

          <button
            onClick={handleDownloadAll}
            disabled={visibleTabs.length === 0}
            className={quietToolbarButtonClass}
            title="Download all files as ZIP"
          >
            <Download className="h-3 w-3" strokeWidth={2} />
            Download All
          </button>

          <button
            onClick={() => void handleSyncBackend({ force: true })}
            disabled={isSyncingBackend || !user || !accessToken || snippets.length === 0}
            className={cn(
              toolbarButtonClass,
              user && accessToken && snippets.length > 0 && !isSyncingBackend
                ? "border-primary/60 bg-primary/10 text-primary hover:bg-primary/15"
                : "border-border bg-background/40 text-muted-foreground hover:border-border-strong hover:bg-surface-elevated hover:text-foreground"
            )}
            title={user ? "Save the current conversion to the backend" : "Login to sync conversions to the backend"}
          >
            <Upload className="h-3 w-3" strokeWidth={2} />
            {isSyncingBackend ? "Syncing..." : "Sync backend"}
          </button>

          <button
            onClick={() => {
              setSubmittedIssueId("");
              setRaiseIssueOpen(true);
            }}
            className={quietToolbarButtonClass}
            title="Raise an issue"
          >
            Raise Issue
          </button>

          <div className="mx-1 h-4 w-px bg-border" aria-hidden />

          {user ? (
            <div className="flex items-center gap-2">
              <span className="hidden max-w-[140px] truncate text-[11px] text-muted-foreground sm:inline">
                {user.username}
              </span>
              <button
                onClick={handleLogout}
                className={quietToolbarButtonClass}
                title="Sign out"
              >
                <LogOut className="h-3 w-3" strokeWidth={2} />
                Logout
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              className={primaryToolbarButtonClass}
              title="Login or sign up to save your collections"
            >
              <LogIn className="h-3 w-3" strokeWidth={2} />
              Login
            </Link>
          )}
        </div>
      </header>

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
                    navigate("/issues");
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
                <span className="text-muted-foreground">Your Email</span>
                <input
                  type="email"
                  value={issueEmail}
                  onChange={(event) => setIssueEmail(event.target.value)}
                  required
                  className="h-8 w-full rounded-sm border border-border bg-background px-2 font-mono text-[12px] text-foreground outline-none focus:border-border-strong"
                />
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
                            const files: WorkspaceFile[] = ["request.py", artifact?.responseFileName ?? defaultResponseFileName(collectionNames[i])];
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
                              <span className="truncate text-[10px]">generated_script.py</span>
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
          style={{ ["--split-left" as any]: `${dividerPos}%` }}
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
                              try { e.dataTransfer.setData("text/plain", s.id); } catch {}
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
           

            <div className="flex items-center justify-between border-b border-border bg-surface">
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
              <div className="flex items-center gap-2 pr-3">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className={quietToolbarButtonClass}
                      title={activeWorkspaceId ? `Open parser for ${activeWorkspaceDisplayName}` : "Open parser"}
                    >
                      <FileCode className="h-4 w-4" strokeWidth={2} />
                      Parser
                      <ChevronDown className="h-3 w-3" strokeWidth={2} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="border-border bg-background text-foreground">
                    <DropdownMenuItem className="text-[11px]" onClick={() => openParserPage("json")}>
                      JSON Parser
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="cursor-not-allowed text-[11px] text-muted-foreground opacity-60 focus:bg-transparent focus:text-muted-foreground"
                      disabled
                      title="HTML Parser coming soon"
                    >
                      HTML Parser
                      <span className="ml-2 text-[10px] text-muted-foreground/70">coming soon</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  onClick={() => void handleRunActiveWorkspace()}
                  disabled={!activeWorkspaceId || isRunning}
                  className={cn(
                    toolbarButtonClass,
                    activeWorkspaceId
                      ? "border-primary/60 bg-primary/10 text-primary hover:bg-primary/15"
                      : "border-border bg-background/40 text-muted-foreground hover:border-border-strong hover:bg-surface-elevated hover:text-foreground"
                  )}
                  title={activeWorkspaceId ? `Run ${activeWorkspaceDisplayName}` : "Select a workspace to run"}
                >
                  {isRunning ? (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                  ) : (
                    <Play className="h-4 w-4" strokeWidth={2} />
                  )}
                  {isRunning ? "Running..." : "Run"}
                </button>
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
                          <span>{t.filename}</span>
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
                    <MetaRow tab={activeTab} blocks={blocks} names={effectiveNames} actions={currentFileActions} />

                    <div className="relative min-h-0 flex-1 overflow-auto">
                      {activeWorkspaceFile !== "parser.py" && activeTab.hasError && activeTab.kind === "request" ? (
                        <div className="m-3 rounded-sm border border-destructive/40 bg-destructive/5 p-3 text-[12px] text-destructive">
                          Issue in {effectiveNames[activeTab.reqIdx ?? 0]}
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {blocks[activeTab.reqIdx ?? 0]?.parsed.error || "Empty snippet - paste a curl command"}
                          </div>
                        </div>
                      ) : (
                        <pre className="px-4 py-3">
                          <HighlightedPython code={panelCodeContent} />
                        </pre>
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
                    <ResponseBodyViewer source={activeResponseJson} />
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
    if (typeof parsed === "string") {
      const trimmed = parsed.trim();
      try {
        const nested = JSON.parse(trimmed);
        return { kind: "json", value: nested };
      } catch {
        return { kind: "html", value: parsed };
      }
    }
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

function parseJsonLike(value: string) {
  const cleaned = value.trim().replace(/;+\s*$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const converted = cleaned
      .replace(/'/g, "\"")
      .replace(/([{,]\s*)([A-Za-z_$][\w$-]*)(\s*:)/g, "$1\"$2\"$3")
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/\bundefined\b/g, "null")
      .replace(/\bNaN\b/g, "null");
    return JSON.parse(converted);
  }
}

function extractJsonFromScriptText(script: string, directJson = false): ScriptJsonTextExtraction {
  if (directJson) {
    try {
      return { ok: true, value: JSON.parse(script), raw: script, mode: "json" };
    } catch {
      // Some JSON script tags contain whitespace/comments around a JSON object; fall through to balanced candidates.
    }
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
    try {
      validCandidates.push({ value: parseJsonLike(jsonLike), raw: jsonLike, mode: "assignment" });
    } catch {
      // Keep scanning; the largest valid assignment wins below.
    }
  }

  findBalancedJsonCandidates(script).forEach((candidate) => {
    try {
      validCandidates.push({ value: parseJsonLike(candidate.raw), raw: candidate.raw, mode: "json" });
    } catch {
      // Ignore invalid balanced JS blocks.
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
    if (!acc) return part;
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(part) ? `${acc}.${part}` : `${acc}[${JSON.stringify(part)}]`;
  }, "");
}

function parseJsonPath(path: string): Array<string | number> {
  const parts: Array<string | number> = [];
  const pattern = /([A-Za-z_$][A-Za-z0-9_$]*)|\[(\d+)\]|\["([^"]+)"\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(path))) {
    if (match[1]) parts.push(match[1]);
    else if (match[2]) parts.push(Number(match[2]));
    else if (match[3]) parts.push(match[3]);
  }
  return parts;
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

function getParserPathWarning(path: string) {
  const trimmed = path.trim();
  if (!trimmed) return "Path is required";
  if (/[.[\]]$/.test(trimmed)) return "Path is incomplete";
  const parts = parseJsonPath(trimmed);
  if (parts.length === 0) return "Path is invalid";
  return "";
}

function getOutputKeyFromPath(path: string, fallback = "value") {
  const parts = normalizeSelectionParts(path);
  const lastKey = [...parts].reverse().find((part): part is string => typeof part === "string");
  return sanitizeOutputKey(lastKey || fallback);
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
    });
  });

  return optimized;
}

function getJsonLoopContexts(selections: ParserSelection[]) {
  const contexts = new Set<string>();
  selections.forEach((selection) => {
    const parts = normalizeSelectionParts(selection.path);
    for (let index = 0; index < parts.length - 1; index += 1) {
      if (typeof parts[index] === "string" && typeof parts[index + 1] === "number") {
        const parent = parts.slice(0, index + 1).filter((part): part is string => typeof part === "string");
        contexts.add(`${parent.join(".")}[*]`);
      }
    }
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
  if (output && typeof output === "object") return 1;
  return output == null ? 0 : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isListOfRecords(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length > 0 && value.every(isRecord);
}

function sanitizePythonName(value: string) {
  const name = sanitizeOutputKey(value);
  return /^[0-9]/.test(name) ? `item_${name}` : name;
}

interface ParserField {
  outputKey: string;
  path: string[];
}

interface ParserArrayGroup {
  prop: string;
  accessPath: string[];
  fullPath: string[];
  fields: ParserField[];
  children: ParserArrayGroup[];
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

function getOrCreateArrayGroup(groups: ParserArrayGroup[], prop: string, accessPath: string[], fullPath = accessPath) {
  const key = fullPath.join(".");
  let group = groups.find((item) => item.fullPath.join(".") === key);
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
  const accessPath = parts.slice(0, arrayIndex + 1).filter((part): part is string => typeof part === "string");
  const group = getOrCreateArrayGroup(groups, prop, accessPath, accessPath);
  addSelectionRemainder(group, selection, parts.slice(arrayIndex + 2));
}

function addSelectionRemainder(group: ParserArrayGroup, selection: ParserSelection, remainder: Array<string | number>) {
  const arrayIndex = findNextArray(remainder);
  if (arrayIndex !== -1) {
    const prop = String(remainder[arrayIndex]);
    const accessPath = remainder.slice(0, arrayIndex + 1).filter((part): part is string => typeof part === "string");
    const child = getOrCreateArrayGroup(group.children, prop, accessPath, [...group.fullPath, ...accessPath]);
    addSelectionRemainder(child, selection, remainder.slice(arrayIndex + 2));
    return;
  }

  const fieldPath = remainder.filter((part): part is string => typeof part === "string");
  if (fieldPath.length === 0) return;
  if (!group.fields.some((field) => field.outputKey === selection.outputKey && field.path.join(".") === fieldPath.join("."))) {
    group.fields.push({ outputKey: selection.outputKey, path: fieldPath });
  }
}

function pythonString(value: string) {
  return JSON.stringify(value);
}

function getFromExpression(base: string, path: string[]) {
  if (path.length === 1) return `${base}.get(${pythonString(path[0])})`;
  return `_get_value(${base}, [${path.map(pythonString).join(", ")}])`;
}

function collectionExpression(base: string, path: string[]) {
  if (path.length === 0) return base;
  if (path.length === 1) return `${base}.get(${pythonString(path[0])}, [])`;
  return `_get_value(${base}, [${path.map(pythonString).join(", ")}]) or []`;
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
    lines.push(`${indent}    results.append({`);
    group.fields.forEach((field, index) => {
      const comma = index < group.fields.length - 1 ? "," : "";
      lines.push(`${indent}        ${pythonString(field.outputKey)}: ${getFromExpression(itemVar, field.path)}${comma}`);
    });
    lines.push(`${indent}    })`);
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

function generateParserCode(workspaceName: string, selections: ParserSelection[], source: "response_json" | "script_json" = "response_json") {
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
    });
  });
  const rootFields: ParserField[] = [];
  const groups: ParserArrayGroup[] = [];

  deduped.forEach((selection) => {
    const parts = normalizeSelectionParts(selection.path);
    if (typeof parts[0] === "number") {
      const group = getOrCreateArrayGroup(groups, "items", []);
      addSelectionRemainder(group, selection, parts.slice(1));
      return;
    }
    if (findNextArray(parts) === -1) {
      const fieldPath = parts.filter((part): part is string => typeof part === "string");
      if (fieldPath.length > 0) {
        rootFields.push({ outputKey: selection.outputKey, path: fieldPath });
      }
      return;
    }
    addSelectionToGroups(groups, selection, parts);
  });

  const lines = [
    `def ${functionName}(response):`,
    "    try:",
    source === "script_json"
      ? "        data = extract_json_from_script(response.text)"
      : "        data = response if isinstance(response, (dict, list)) else response.json()",
    "    except Exception:",
    "        return []",
    "",
    "    def _get_value(container, path):",
    "        current = container",
    "        for key in path:",
    "            if not isinstance(current, dict):",
    "                return None",
    "            current = current.get(key)",
    "        return current",
    "",
    "    def _iter_items(value):",
    "        if isinstance(value, dict):",
    "            return value.values()",
    "        if isinstance(value, list):",
    "            return value",
    "        return []",
    "",
  ];

  if (rootFields.length > 0 && groups.length === 0) {
    lines.push("    return {");
    rootFields.forEach((field, index) => {
      const comma = index < rootFields.length - 1 ? "," : "";
      lines.push(`        ${pythonString(field.outputKey)}: ${getFromExpression("data", field.path)}${comma}`);
    });
    lines.push("    }");
    lines.push("");
    return lines.join("\n");
  }

  if (rootFields.length === 0 && groups.length > 0) {
    lines.push("    results = []");
    lines.push("");
    groups.forEach((group, index) => {
      emitArrayGroup(lines, group, "data", "    ", new Set());
      if (index < groups.length - 1) lines.push("");
    });
    lines.push("    return results");
    lines.push("");
    return lines.join("\n");
  }

  if (rootFields.length > 0 && groups.length > 0) {
    const usedVars = new Set<string>();
    const groupRows = groups.map((group) => {
      const rowsVar = emitArrayGroupRows(lines, group, "data", "    ", usedVars);
      lines.push("");
      return { group, rowsVar };
    });
    lines.push("    return {");
    const entries = [
      ...rootFields.map((field) => ({
        key: field.outputKey,
        value: getFromExpression("data", field.path),
      })),
      ...groupRows.map(({ group, rowsVar }) => ({
        key: sanitizeOutputKey(group.prop),
        value: rowsVar,
      })),
    ];
    entries.forEach((entry, index) => {
      const comma = index < entries.length - 1 ? "," : "";
      lines.push(`        ${pythonString(entry.key)}: ${entry.value}${comma}`);
    });
    lines.push("    }");
    lines.push("");
    return lines.join("\n");
  }

  lines.push("    return {}");
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
  const type = script.getAttribute("type");
  if (type) return `(//script[@type=${xpathLiteral(type)}])[${scriptIndex}]/text()`;
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
  ];

  if (mode === "json") {
    return [
      ...base,
      "def extract_script_json(response):",
      "    selector = Selector(text=response.text)",
      `    raw = selector.xpath(${pythonString(scriptXPath)}).get()`,
      "    if not raw:",
      "        return None",
      "    return json.loads(raw)",
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
    "    return json.loads(payload)",
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
    json: JSON.stringify(extracted.value, null, 2),
    extractorCode: buildScriptJsonExtractorCode(scriptXPath, extracted.mode),
    scriptId: stableHash({ scriptXPath, raw: extracted.raw.slice(0, 2000), length: extracted.raw.length }),
  };
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
  selectedPath,
  addedPaths,
  onAddToParser,
  onSelectedPathChange,
}: {
  source: string;
  selectedPath?: string | null;
  addedPaths?: Set<string>;
  onAddToParser?: (path: string) => void;
  onSelectedPathChange?: (path: string | null, value?: unknown) => void;
}) {
  const mode = useMemo(() => detectResponseMode(source), [source]);

  if (mode.kind === "json") {
    return (
      <JsonResponseViewer
        value={mode.value}
        selectedPath={selectedPath}
        addedPaths={addedPaths}
        onAddToParser={onAddToParser}
        onSelectedPathChange={onSelectedPathChange}
      />
    );
  }

  return <HtmlResponseViewer html={mode.value} />;
}

function JsonResponseViewer({
  value,
  selectedPath,
  addedPaths,
  onAddToParser,
  onSelectedPathChange,
}: {
  value: unknown;
  selectedPath?: string | null;
  addedPaths?: Set<string>;
  onAddToParser?: (path: string) => void;
  onSelectedPathChange?: (path: string | null, value?: unknown) => void;
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
      {!selected && (
        <div className="mb-3 rounded-sm border border-border bg-surface/35 px-3 py-2 text-[11px] text-muted-foreground">
          Select a JSON key or value
        </div>
      )}
      {selected && (
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
          {onAddToParser && (
            <button
              onClick={() => onAddToParser(selected.path)}
              className="text-primary hover:text-foreground"
            >
              Add to Paths
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

function JsonTreeNode({
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
  const entries = isObject ? Object.entries(value as Record<string, unknown>) : [];
  const displayName = name !== undefined ? String(name) : "";
  const pathString = formatJsonPath(path);
  const isTemporarySelected = selectedPath === pathString;
  const isPermanentlySelected = addedPaths?.has(pathString) ?? false;
  const highlightClass = isTemporarySelected
    ? "rounded-sm bg-emerald-500/10 outline outline-1 outline-emerald-500/45 outline-offset-1"
    : isPermanentlySelected
      ? "rounded-sm bg-emerald-500/15 outline outline-1 outline-emerald-500/70 outline-offset-1"
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
          const childPath = [...path, isArray ? Number(key) : key];
          return (
            <div key={`${key}-${index}`} className="flex items-start gap-1">
              <JsonTreeNode
                value={child}
                path={childPath}
                name={isArray ? Number(key) : key}
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
  onOpenScriptJson,
}: {
  html: string;
  addedPaths?: Set<string>;
  onAddToParser?: (selection: ParserSelection) => void;
  onOpenScriptJson?: (source: ScriptJsonSource) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialPreview = useMemo(() => previewSourceLines(html), [html]);
  const [showFullHtml, setShowFullHtml] = useState(!initialPreview.isPreview);
  const visibleHtml = showFullHtml ? html : initialPreview.preview;
  const documentNode = useMemo(() => new DOMParser().parseFromString(visibleHtml, "text/html"), [visibleHtml]);
  const [selectedElement, setSelectedElement] = useState<HtmlElementSelection | null>(null);
  const root = documentNode.documentElement;
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
          {onAddToParser && (
            <button
              onClick={() => {
                try {
                  onAddToParser({
                    path: selectedElement.xpath,
                    selector: selectedElement.xpath,
                    xpath: selectedElement.xpath,
                    css: selectedElement.cssSelector,
                    selectorType: "xpath",
                    outputKey: getOutputKeyFromHtmlSelector(selectedElement.cssSelector || selectedElement.xpath),
                    extractMode: "text",
                    valueMode: "text",
                    parentSelector: selectedElement.parentXpath,
                    parentSelectorType: selectedElement.parentXpath ? "xpath" : undefined,
                    parentXpath: selectedElement.parentXpath,
                    parentCss: selectedElement.parentCss,
                    relativeSelector: selectedElement.relativeXpath,
                    relativeXpath: selectedElement.relativeXpath,
                    relativeCss: selectedElement.relativeCss,
                  });
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Could not add selector");
                }
              }}
              className="text-primary hover:text-foreground"
            >
              Add to Paths
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
          isSelected
            ? "rounded-sm bg-emerald-500/10 text-primary outline outline-1 outline-emerald-500/45 outline-offset-1"
            : isAdded
              ? "rounded-sm bg-emerald-500/15 text-foreground outline outline-1 outline-emerald-500/70 outline-offset-1"
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
  const rows = isListOfRecords(value) ? value : [];
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

function MetaRow({ tab, blocks, names, actions }: { tab: OutputTab; blocks: SnippetBlock[]; names: string[]; actions?: ReactNode }) {
  if (tab.kind === "merged") {
    const valid = blocks.filter((b) => b.raw.trim() && !b.parsed.error).length;
    return (
      <div className="flex items-center gap-2 border-b border-border bg-background px-4 py-1.5 font-mono text-[12px]">
        <span className="font-semibold text-primary">MULTI</span>
        <span className="text-syntax-comment">|</span>
        <span className="text-foreground">{valid} snippet{valid === 1 ? "" : "s"}</span>
        <span className="text-syntax-comment">|</span>
        <span className="text-muted-foreground">Combined Script</span>
        {actions}
      </div>
    );
  }
  if (tab.kind === "parser") {
    return (
      <div className="flex items-center gap-2 border-b border-border bg-background px-4 py-1.5 font-mono text-[12px]">
        <span className="font-semibold text-syntax-function">PARSER</span>
        <span className="text-syntax-comment">|</span>
        <span className="text-muted-foreground">Auto-generated</span>
        {actions}
      </div>
    );
  }
  const idx = tab.reqIdx ?? 0;
  const parsed = blocks[idx]?.parsed;
  if (!parsed || parsed.error) {
    return (
      <div className="flex items-center gap-2 border-b border-border bg-background px-4 py-1.5 font-mono text-[12px]">
        <span className="font-semibold text-destructive">REQUEST</span>
        <span className="text-syntax-comment">|</span>
        <span className="text-primary">{names[idx] ?? tab.filename}</span>
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
    <div className="flex items-center gap-2 border-b border-border bg-background px-4 py-1.5 font-mono text-[12px]">
      <span className={cn("font-semibold", methodColor[m] || "text-foreground")}>{m}</span>
      <span className="text-syntax-comment">|</span>
      <span className="text-foreground">{parsed.domain}</span>
      <span className="text-syntax-comment">|</span>
      <span className="text-muted-foreground">{parsed.dataType}</span>
      <span className="text-syntax-comment">|</span>
      <span className="text-primary">{names[idx]}</span>
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


