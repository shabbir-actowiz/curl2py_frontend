import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, ChevronDown, ChevronRight, ChevronUp, AlertCircle, Terminal, Download, X, PanelLeft, FileCode, Save, FolderOpen, LogIn, Plus, Trash2, GripVertical, Upload, LogOut, Pencil, Moon, Sun } from "lucide-react";
import JSZip from "jszip";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  parseCurl,
  type ParsedCurl,
} from "@/lib/curl-to-python";
import { HighlightedPython } from "@/lib/python-highlight";
import {
  convertWithBackend,
  deleteConversionCollection,
  deleteConversionSnippet,
  extractApiErrorMessage,
  getUserWorkspace,
  renameConversionCollection,
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

type WorkspacePanelTab = "code" | "response" | "logs";
type InputPanelTab = "input" | "proxy";
type ThemeMode = "dark" | "light";
type WorkspaceFile = string;

interface ProxyConfig {
  enabled: boolean;
  url: string;
}

interface WorkspaceArtifact {
  responseJson: string | null;
  responseFileName?: string;
  responseContentType?: string;
  responseExtension?: string;
  metaJson: string | null;
  logsTxt: string;
  parserCode: string;
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

const SAMPLE_SNIPPETS: Snippet[] = [];

const BACKEND_PLACEHOLDER = "# Connect to the backend and sync to generate Python code\n";
const DEFAULT_PROXY_CONFIG: ProxyConfig = { enabled: false, url: "" };

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
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>("");
  const [activeWorkspaceFile, setActiveWorkspaceFile] = useState<WorkspaceFile>("request.py");
  const [activeInputTab, setActiveInputTab] = useState<InputPanelTab>("input");
  const [activePanelTab, setActivePanelTab] = useState<WorkspacePanelTab>("code");
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
      tabs.push({
        id: "parser",
        kind: "parser",
        filename: "parser.py",
        code: backendParserOutput ?? BACKEND_PLACEHOLDER,
      });
    }

    return tabs;
  }, [blocks, outputs, mergeMode, validBlocks, backendMergedOutput, backendParserOutput]);

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
  const activeCodeFilename = activeWorkspaceFile === "parser.py" ? "parser.py" : activeTab?.filename || "-";
  const activeCodeContent = activeWorkspaceFile === "parser.py"
    ? activeWorkspaceArtifact?.parserCode ?? buildParserStub(activeWorkspaceName || "request")
    : activeRequestCode;
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
  const activeResponseJson = activeResponseArtifact?.responseJson;
  const activeResponseMeta = readWorkspaceMeta(activeResponseArtifact?.metaJson ?? null);
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
          setOpenResponseTabs((workspace.openResponseTabs as ResponseTab[]) || []);
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
        openResponseTabs,
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

  const openResponseFile = (collectionId: string, workspaceId: string, fileNameOverride?: string) => {
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
      const withoutWorkspace = prev.filter((item) => !(item.collectionId === collectionId && item.workspaceId === workspaceId));
      return withoutWorkspace.some((item) => item.id === tabId) ? withoutWorkspace : [...withoutWorkspace, tab];
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
          responseJson: null,
          metaJson: null,
          logsTxt: `[error] ${errorMessage}`,
          parserCode: buildParserStub(workspaceName),
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
          responseJson,
          responseFileName,
          responseContentType: data.content_type,
          responseExtension: data.extension,
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
    return panelCodeContent;
  };

  const handleCopyActive = async () => {
    const content = getActivePanelContent();
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1400);
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
        className="flex h-5 w-5 items-center justify-center rounded-sm border border-border bg-transparent text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
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
        className="flex h-5 w-5 items-center justify-center rounded-sm border border-border bg-transparent text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        title="Download current file"
        aria-label="Download current file"
      >
        <Download className="h-3 w-3" strokeWidth={2} />
      </button>
    </div>
  );

  const handleRunActiveWorkspace = () => {
    if (!activeWorkspaceId) return;
    void runWorkspace(activeWorkspaceId);
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

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* TOP BAR */}
      <header className="flex h-12 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSidebarOpen((s) => !s)}
            className="mr-1 flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground"
            title={sidebarOpen ? "Hide collection" : "Show collection"}
            aria-label="Toggle collection"
          >
            <PanelLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <Terminal className="h-4 w-4 text-primary" strokeWidth={1.75} />
          <h1 className="text-[13px] font-semibold tracking-tight">
            <span className="text-primary">curl</span>
            <span className="text-muted-foreground">2</span>
            <span className="text-foreground">py</span>
          </h1>
          
        </div>

        <div className="flex items-center gap-2">

          <button
            onClick={() => setTheme((value) => value === "dark" ? "light" : "dark")}
            className="flex items-center gap-1.5 rounded-sm border border-border bg-transparent px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun className="h-3 w-3" strokeWidth={2} /> : <Moon className="h-3 w-3" strokeWidth={2} />}
            {theme === "dark" ? "Light" : "Dark"}
          </button>

          <button
            onClick={() => setMergeMode((s) => !s)}
            className={cn(
              "flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] transition-colors",
              mergeMode
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-border bg-transparent text-muted-foreground hover:border-border-strong hover:text-foreground"
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
            className="flex items-center gap-1.5 rounded-sm border border-border bg-transparent px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            title="Download all files as ZIP"
          >
            <Download className="h-3 w-3" strokeWidth={2} />
            Download All
          </button>

          <button
            onClick={() => void handleSyncBackend({ force: true })}
            disabled={isSyncingBackend || !user || !accessToken || snippets.length === 0}
            className={cn(
              "flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] transition-colors",
              user && accessToken && snippets.length > 0 && !isSyncingBackend
                ? "border-primary/60 bg-primary/10 text-primary hover:bg-primary/15"
                : "border-border bg-transparent text-muted-foreground hover:border-border-strong hover:text-foreground",
              (isSyncingBackend || !user || !accessToken || snippets.length === 0) && "cursor-not-allowed opacity-40"
            )}
            title={user ? "Save the current conversion to the backend" : "Login to sync conversions to the backend"}
          >
            <Upload className="h-3 w-3" strokeWidth={2} />
            {isSyncingBackend ? "Syncing" : "Sync backend"}
          </button>

          <div className="mx-1 h-4 w-px bg-border" aria-hidden />

          {user ? (
            <div className="flex items-center gap-2">
              <span className="hidden max-w-[140px] truncate text-[11px] text-muted-foreground sm:inline">
                {user.username}
              </span>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 rounded-sm border border-border bg-transparent px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                title="Sign out"
              >
                <LogOut className="h-3 w-3" strokeWidth={2} />
                Logout
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              className="flex items-center gap-1.5 rounded-sm border border-primary/60 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
              title="Login or sign up to save your collections"
            >
              <LogIn className="h-3 w-3" strokeWidth={2} />
              Login
            </Link>
          )}
        </div>
      </header>

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
                          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-mono transition-colors",
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
                            const files: WorkspaceFile[] = ["request.py", "parser.py", artifact?.responseFileName ?? defaultResponseFileName(collectionNames[i])];
                            return (
                              <div key={b.id}>
                                <div
                                  onClick={() => toggleWorkspace(b.id, collection.id)}
                                  onMouseEnter={() => setHoveredSnippetId(b.id)}
                                  onMouseLeave={() => setHoveredSnippetId(null)}
                                  className={cn(
                                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-mono transition-colors",
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
                            <>
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
                              <button
                                onClick={() => { setActivePanelTab("code"); setActiveWorkspaceFile("request.py"); setActiveTabId("parser"); setClosedTabIds((p) => { const n = new Set(p); n.delete("parser"); return n; }); }}
                                className={cn(
                                  "flex w-full items-center gap-2 px-3 py-1 text-left font-mono transition-colors",
                                  activeTab?.id === "parser"
                                    ? "bg-primary/[0.07] text-foreground"
                                    : "text-muted-foreground hover:bg-surface-elevated hover:text-foreground"
                                )}
                              >
                                <FileCode className="h-3 w-3 shrink-0" strokeWidth={2} />
                                <span className="truncate text-[10px]">parser.py</span>
                              </button>
                            </>
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
                    className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-dashed border-border bg-transparent px-3 py-2 text-[11px] font-mono text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary/[0.04] hover:text-primary"
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
                      "border-r border-border px-3 py-2 text-[11px] font-mono transition-colors",
                      activePanelTab === tab
                        ? "border-t border-t-primary bg-background text-foreground"
                        : "text-muted-foreground hover:bg-surface-elevated hover:text-foreground"
                    )}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 pr-3">
                <button
                  onClick={handleRunActiveWorkspace}
                  disabled={!activeWorkspaceId}
                  className={cn(
                    "flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] transition-colors",
                    activeWorkspaceId
                      ? "border-primary/60 bg-primary/10 text-primary hover:bg-primary/15"
                      : "border-border bg-transparent text-muted-foreground hover:border-border-strong hover:text-foreground",
                    !activeWorkspaceId && "cursor-not-allowed opacity-40"
                  )}
                  title={activeWorkspaceId ? `Run ${activeWorkspaceDisplayName}` : "Select a workspace to run"}
                >
                  Run
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
                            "group flex cursor-pointer items-center gap-1.5 border-r border-border px-3 py-2 text-[11px] font-mono transition-colors",
                            isActive
                              ? "bg-background text-foreground"
                              : "text-muted-foreground hover:bg-surface-elevated hover:text-foreground",
                            isHover && !isActive && "bg-surface-elevated text-foreground",
                            t.hasError && "text-destructive",
                            isActive && "border-t border-t-primary"
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
                            "group flex cursor-pointer items-center gap-1.5 border-r border-border px-3 py-2 text-[11px] font-mono transition-colors",
                            isActive
                              ? "bg-background text-foreground"
                              : "text-muted-foreground hover:bg-surface-elevated hover:text-foreground",
                            isActive && "border-t border-t-primary"
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
                    <div className="px-4 py-3 text-[11px] text-muted-foreground">No response yet</div>
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

function stringifyJsonValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function formatJsonPath(path: Array<string | number>): string {
  return path.reduce((acc, part) => {
    if (typeof part === "number") return `${acc}[${part}]`;
    if (!acc) return part;
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(part) ? `${acc}.${part}` : `${acc}[${JSON.stringify(part)}]`;
  }, "");
}

async function copyText(value: string, label: string) {
  await navigator.clipboard.writeText(value);
  toast.success(label);
}

function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat('${value.replace(/'/g, `', "'", '`)}')`;
}

function cssEscape(value: string): string {
  const css = window.CSS as CSS & { escape?: (value: string) => string };
  if (css?.escape) return css.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function getXPath(element: Element): string {
  if (element.id) {
    return `//*[@id=${xpathLiteral(element.id)}]`;
  }

  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === current.tagName) index += 1;
      sibling = sibling.previousElementSibling;
    }
    parts.unshift(`${current.tagName.toLowerCase()}[${index}]`);
    current = current.parentElement;
  }

  return `/${parts.join("/")}`;
}

function getCssSelector(element: Element): string {
  if (element.id) {
    return `#${cssEscape(element.id)}`;
  }

  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && current.tagName.toLowerCase() !== "html") {
    let selector = current.tagName.toLowerCase();
    const className = current.getAttribute("class");
    if (className) {
      const firstClass = className.trim().split(/\s+/)[0];
      if (firstClass) selector += `.${cssEscape(firstClass)}`;
    }
    const parent = current.parentElement;
    if (parent) {
      const sameTagSiblings = Array.from(parent.children).filter((child) => child.tagName === current?.tagName);
      if (sameTagSiblings.length > 1) {
        selector += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
      }
    }
    parts.unshift(selector);
    current = parent;
  }

  return parts.join(" > ");
}

function ResponseBodyViewer({ source }: { source: string }) {
  const mode = useMemo(() => detectResponseMode(source), [source]);

  if (mode.kind === "json") {
    return <JsonResponseViewer value={mode.value} />;
  }

  return <HtmlResponseViewer html={mode.value} />;
}

function JsonResponseViewer({ value }: { value: unknown }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<{ path: string; value: unknown; x: number; y: number } | null>(null);
  useEffect(() => setSelected(null), [value]);

  return (
    <div
      ref={containerRef}
      className="relative px-4 py-3 font-mono text-[12px] leading-[1.6] text-foreground"
      onClick={(e) => {
        if (e.target === e.currentTarget) setSelected(null);
      }}
    >
      {selected && (
        <div
          className="absolute z-20 flex items-center gap-2 bg-background text-[11px]"
          style={{ left: selected.x, top: selected.y + 18 }}
        >
          <span className="max-w-[40ch] truncate text-muted-foreground">{selected.path || "root"}</span>
          <button
            onClick={() => void copyText(selected.path, "Copied JSON path")}
            className="text-primary hover:text-foreground"
          >
            Copy Path
          </button>
          <button
            onClick={() => void copyText(stringifyJsonValue(selected.value), "Copied value")}
            className="text-primary hover:text-foreground"
          >
            Copy value
          </button>
        </div>
      )}
      <JsonTreeNode
        value={value}
        path={["response"]}
        name="response"
        onSelect={(path, nodeValue, event) => {
          const rect = containerRef.current?.getBoundingClientRect();
          setSelected({
            path: formatJsonPath(path),
            value: nodeValue,
            x: rect ? event.clientX - rect.left : 12,
            y: rect ? event.clientY - rect.top : 12,
          });
        }}
      />
    </div>
  );
}

function JsonTreeNode({
  value,
  path,
  name,
  onSelect,
}: {
  value: unknown;
  path: Array<string | number>;
  name?: string | number;
  onSelect: (path: Array<string | number>, value: unknown, event: React.MouseEvent) => void;
}) {
  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === "object";
  const entries = isObject ? Object.entries(value as Record<string, unknown>) : [];
  const displayName = name !== undefined ? String(name) : "";

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
      <button
        onClick={(e) => {
          e.stopPropagation();
          onSelect(path, value, e);
        }}
        className="block text-left hover:text-foreground"
      >
        {displayName && <span className="text-syntax-function">"{displayName}": </span>}
        <span className={valueClass}>{typeof value === "string" ? JSON.stringify(value) : String(value)}</span>
      </button>
    );
  }

  return (
    <div className="text-foreground">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onSelect(path, value, e);
        }}
        className="text-left hover:text-foreground"
      >
        {displayName && <span className="text-syntax-function">"{displayName}": </span>}
        <span className="text-syntax-punct">{isArray ? "[" : "{"}</span>
      </button>
      <div className="pl-4">
        {entries.map(([key, child], index) => {
          const childPath = [...path, isArray ? Number(key) : key];
          return (
            <div key={`${key}-${index}`} className="flex items-start gap-1">
              <JsonTreeNode
                value={child}
                path={childPath}
                name={isArray ? Number(key) : key}
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

function HtmlResponseViewer({ html }: { html: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const documentNode = useMemo(() => new DOMParser().parseFromString(html, "text/html"), [html]);
  const [selectedElement, setSelectedElement] = useState<{ element: Element; x: number; y: number } | null>(null);
  const root = documentNode.documentElement;
  const xpath = selectedElement ? getXPath(selectedElement.element) : "";
  const cssSelector = selectedElement ? getCssSelector(selectedElement.element) : "";
  useEffect(() => setSelectedElement(null), [html]);

  return (
    <div
      ref={containerRef}
      className="relative px-4 py-3 font-mono text-[12px] leading-[1.6] text-foreground"
      onClick={(e) => {
        if (e.target === e.currentTarget) setSelectedElement(null);
      }}
    >
      {selectedElement && (
        <div
          className="absolute z-20 flex items-center gap-2 bg-background text-[11px]"
          style={{ left: selectedElement.x, top: selectedElement.y + 18 }}
        >
          <span className="max-w-[32ch] truncate text-muted-foreground">{selectedElement.element.tagName.toLowerCase()}</span>
          <button
            onClick={() => void copyText(xpath, "Copied XPath")}
            className="text-primary hover:text-foreground"
          >
            Copy XPath
          </button>
          <button
            onClick={() => void copyText(cssSelector, "Copied CSS selector")}
            className="text-primary hover:text-foreground"
          >
            Copy CSS
          </button>
          <button
            onClick={() => void copyText(selectedElement.element.textContent || "", "Copied text")}
            className="text-primary hover:text-foreground"
          >
            Copy Text
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
            selectedElement={selectedElement?.element ?? null}
            onSelect={(element, event) => {
              const rect = containerRef.current?.getBoundingClientRect();
              setSelectedElement({
                element,
                x: rect ? event.clientX - rect.left : 12,
                y: rect ? event.clientY - rect.top : 12,
              });
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
  selectedElement,
  onSelect,
}: {
  element: Element;
  selectedElement: Element | null;
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
  const isSelected = selectedElement === element;

  return (
    <div className="pl-3">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onSelect(element, e);
        }}
        className={cn(
          "block text-left font-mono text-[12px] leading-[1.6] hover:text-foreground",
          isSelected ? "text-primary" : "text-muted-foreground"
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
          selectedElement={selectedElement}
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
      <div className="flex items-center gap-2 border-b border-border bg-background px-4 py-1.5 font-mono text-[11px]">
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
      <div className="flex items-center gap-2 border-b border-border bg-background px-4 py-1.5 font-mono text-[11px]">
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
      <div className="flex items-center gap-2 border-b border-border bg-background px-4 py-1.5 font-mono text-[11px]">
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
    <div className="flex items-center gap-2 border-b border-border bg-background px-4 py-1.5 font-mono text-[11px]">
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
