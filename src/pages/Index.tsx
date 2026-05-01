import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check,Code, Copy, ChevronDown, ChevronRight, ChevronUp, AlertCircle, Terminal, Download, X, PanelLeft, FileCode, Save, FolderOpen, LogIn, Plus, Trash2, GripVertical, Upload, LogOut } from "lucide-react";
import JSZip from "jszip";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  parseCurl,
  type ParsedCurl,
} from "@/lib/curl-to-python";
import { HighlightedPython } from "@/lib/python-highlight";
import { convertWithBackend, extractApiErrorMessage, runWorkspaceWithBackend } from "@/lib/api";
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
type WorkspaceFile = "request.py" | "parser.py" | "response.json" | "meta.json" | "logs.txt";

interface WorkspaceArtifact {
  responseJson: string | null;
  metaJson: string | null;
  logsTxt: string;
  parserCode: string;
}

const SESSION_KEY = "curl2py:session:v2";

const SAMPLE_SNIPPETS: Snippet[] = [];

const BACKEND_PLACEHOLDER = "# Connect to the backend and sync to generate Python code\n";

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
  return Math.random().toString(36).slice(2, 9);
}

export default function Index() {
  const [snippets, setSnippets] = useState<Snippet[]>(SAMPLE_SNIPPETS);
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
  const [backendOutputs, setBackendOutputs] = useState<Record<string, string>>({});
  const [backendMergedOutput, setBackendMergedOutput] = useState<string | null>(null);
  const [backendParserOutput, setBackendParserOutput] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>("");
  const [activeWorkspaceFile, setActiveWorkspaceFile] = useState<WorkspaceFile>("request.py");
  const [activePanelTab, setActivePanelTab] = useState<WorkspacePanelTab>("code");
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Set<string>>(new Set());
  const [workspaceArtifacts, setWorkspaceArtifacts] = useState<Record<string, WorkspaceArtifact>>({});
  const [dividerPos, setDividerPos] = useState(50);
  const [isDraggingDivider, setIsDraggingDivider] = useState(false);

  const { user, accessToken, logout } = useAuth();

  const outputRef = useRef<HTMLDivElement>(null);
  const snippetRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const focusNameOnMountId = useRef<string | null>(null);
  const nameInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const mainRef = useRef<HTMLDivElement>(null);

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
  const effectiveNames = useMemo(() => {
    const used = new Set<string>();
    return snippets.map((s, i) => {
      let base = (s.name || "").trim() || `request_${i + 1}`;
      let n = base;
      let k = 2;
      while (used.has(n)) n = `${base}_${k++}`;
      used.add(n);
      return n;
    });
  }, [snippets]);

  const outputs = useMemo(
    () => blocks.map((b) => backendOutputs[b.id] ?? (b.raw.trim() ? BACKEND_PLACEHOLDER : "# Empty snippet — paste a curl command\n")),
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
  const activeCodeFilename = activeWorkspaceFile === "parser.py" ? "parser.py" : activeTab?.filename || "—";
  const activeCodeContent = activeWorkspaceFile === "parser.py"
    ? activeWorkspaceArtifact?.parserCode ?? buildParserStub(activeWorkspaceName || "request")
    : activeRequestCode;
  const activeResponseJson = activeWorkspaceArtifact?.responseJson;
  const activeMetaJson = activeWorkspaceArtifact?.metaJson;
  const activeMeta = readWorkspaceMeta(activeMetaJson);
  const activeLogsTxt = activeWorkspaceArtifact?.logsTxt ?? "";
  const activeWorkspaceDisplayName = activeWorkspaceName || "request";
  const activePanelFilename = activePanelTab === "response"
    ? (activeWorkspaceFile === "meta.json" ? "meta.json" : "response.json")
    : activePanelTab === "logs"
      ? "logs.txt"
      : activeCodeFilename;

  useEffect(() => {
    setBackendOutputs({});
    setBackendMergedOutput(null);
    setBackendParserOutput(null);
  }, [snippets, client, isAsync, mergeMode, user, accessToken]);

  // Auto-sync when snippets change
  useEffect(() => {
    handleSyncBackend({ silent: true });
  }, [snippets, client, isAsync, mergeMode]);

  // Status bar — uses "snippets ready"
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
      setStatusMsg(`Issue in ${sn} — others generated`);
    } else if (dupes > 0) {
      setStatusKind("error");
      setStatusMsg("Duplicate snippet name — auto-suffixed in output");
    } else if (mergeMode) {
      setStatusKind("success");
      setStatusMsg(`✓ ${n} snippet${n === 1 ? "" : "s"} ready · Merged into 2 files`);
    } else {
      setStatusKind("success");
      setStatusMsg(`✓ ${n} snippet${n === 1 ? "" : "s"} ready`);
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

  const openWorkspaceFile = (workspaceId: string, file: WorkspaceFile) => {
    setActiveWorkspaceId(workspaceId);
    setActiveWorkspaceFile(file);
    setExpandedWorkspaceIds((prev) => {
      const next = new Set(prev);
      next.add(workspaceId);
      return next;
    });

    if (file === "request.py") {
      setActivePanelTab("code");
      setActiveTabId(`req-${workspaceId}`);
      return;
    }

    if (file === "parser.py") {
      setActivePanelTab("code");
      if (mergeMode) setActiveTabId("parser");
      return;
    }

    if (file === "response.json" || file === "meta.json") {
      setActivePanelTab("response");
      return;
    }

    setActivePanelTab("logs");
  };

  const toggleWorkspace = (workspaceId: string) => {
    setExpandedWorkspaceIds((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceId)) next.delete(workspaceId);
      else next.add(workspaceId);
      return next;
    });
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
        workspace_name: workspaceName,
        request_code: requestCode,
        parser_code: parserCode,
      });

      const responsePayload = data.success
        ? data.parsed ?? data.response
        : { error: data.error || "Execution failed", logs: data.logs };
      const responseJson = JSON.stringify(responsePayload, null, 2);
      const meta = {
        status: data.status,
        time_ms: data.time_ms,
        size: data.size,
      };

      setWorkspaceArtifacts((prev) => ({
        ...prev,
        [workspaceId]: {
          responseJson,
          metaJson: JSON.stringify(meta, null, 2),
          logsTxt: data.logs,
          parserCode,
        },
      }));

      setActivePanelTab("response");

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
          metaJson: JSON.stringify(meta, null, 2),
          logsTxt: message,
          parserCode,
        },
      }));
      setActivePanelTab("response");
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

  // ─────────── Snippet handlers ───────────
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

  // Click output tab → scroll to snippet
  useEffect(() => {
    if (!activeTab || activeTab.kind !== "request" || activeReqIdx == null) return;
    const block = blocks[activeReqIdx];
    if (!block) return;
    const el = snippetRefs.current[block.id];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeTabId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────── Output handlers ───────────
  const getActivePanelFilename = () => {
    if (activePanelTab === "response") {
      return activeWorkspaceFile === "meta.json" ? "meta.json" : "response.json";
    }
    if (activePanelTab === "logs") {
      return "logs.txt";
    }
    return activeCodeFilename;
  };

  const getActivePanelContent = () => {
    if (activePanelTab === "response") {
      return activeWorkspaceFile === "meta.json"
        ? activeMetaJson || ""
        : activeResponseJson || "";
    }
    if (activePanelTab === "logs") {
      return activeLogsTxt || "";
    }
    return activeCodeContent;
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

  const handleRunActiveWorkspace = () => {
    if (!activeWorkspaceId) return;
    void runWorkspace(activeWorkspaceId);
  };

  const handleDownloadAll = async () => {
    if (visibleTabs.length === 0) return;
    const zip = new JSZip();
    for (const t of visibleTabs) zip.file(t.filename, t.code);
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "curl2py.zip";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatusKind("success");
    setStatusMsg(`✓ Downloaded ${visibleTabs.length} file${visibleTabs.length === 1 ? "" : "s"} as ZIP`);
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
      if (remaining.length > 0) setActiveTabId(remaining[0].id);
    }
  };

  // ─────────── Session ───────────
  const handleSaveSession = () => {
    try {
      const payload = JSON.stringify({ snippets, client, isAsync, mergeMode });
      localStorage.setItem(SESSION_KEY, payload);
      setSavedSession(true);
      setStatusKind("success");
      setStatusMsg("✓ Session saved");
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
      if (Array.isArray(data.snippets)) {
        setSnippets(
          data.snippets.map((s: any) => ({
            id: typeof s.id === "string" ? s.id : newId(),
            name: typeof s.name === "string" ? sanitizeName(s.name) : "request_1",
            raw: typeof s.raw === "string" ? s.raw : "",
            collapsed: !!s.collapsed,
          }))
        );
      }
      if (data.client === "httpx" || data.client === "requests") setClient(data.client);
      if (typeof data.isAsync === "boolean") setIsAsync(data.isAsync);
      if (typeof data.mergeMode === "boolean") setMergeMode(data.mergeMode);
      setClosedTabIds(new Set());
      setStatusKind("success");
      setStatusMsg("✓ Session loaded");
    } catch {
      setStatusKind("error");
      setStatusMsg("Could not load session");
    }
  };

  const handleLogout = () => {
    logout();
    setStatusKind("info");
    setStatusMsg("Signed out");
    toast.success("Signed out");
  };

  async function handleSyncBackend(options: { silent?: boolean } = {}) {
    const silent = options.silent ?? false;

    const conversionTargets = blocks
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => block.raw.trim().length > 0 && !block.parsed.error);

    if (conversionTargets.length === 0) {
      setStatusKind("error");
      setStatusMsg("Add a curl command before syncing");
      if (!silent) {
        toast.error("Add a curl command before syncing");
      }
      return;
    }

    try {
      setIsSyncingBackend(true);
      const singleResults = await Promise.all(
        conversionTargets.map(async ({ block, index }) => {
          const response = await convertWithBackend(
            {
              curl: {
                curl: block.raw,
                function_name: effectiveNames[index],
              },
            },
            accessToken,
          );

          if (!response.success) {
            throw new Error(response.error || response.error_type || `Backend conversion failed for ${effectiveNames[index]}`);
          }

          return {
            id: block.id,
            code: response.python_code ?? response.request_script ?? "",
            functionName: response.function_name ?? effectiveNames[index],
          };
        })
      );

      const nextOutputs: Record<string, string> = {};
      singleResults.forEach((entry) => {
        nextOutputs[entry.id] = entry.code || "# Backend conversion returned no code\n";
      });
      setBackendOutputs(nextOutputs);

      if (mergeMode) {
        const batchResponse = await convertWithBackend(
          {
            commands: conversionTargets.map(({ block, index }) => ({
              curl: block.raw,
              function_name: effectiveNames[index],
            })),
          },
          accessToken,
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

      const label = `${singleResults.length} snippet${singleResults.length === 1 ? "" : "s"}`;
      setStatusKind("success");
      setStatusMsg(`✓ Synced to backend · ${label}`);
      if (!silent) {
        toast.success("Generated code via backend");
      }
    } catch (error) {
      const message = extractApiErrorMessage(error);
      setStatusKind("error");
      setStatusMsg(message);
      if (!silent) {
        toast.error(message);
      }
    } finally {
      setIsSyncingBackend(false);
    }
  }

  useEffect(() => {
    if (!user || !accessToken) {
      return;
    }

    const hasRenderableSnippet = snippets.some((snippet) => snippet.raw.trim().length > 0);
    if (!hasRenderableSnippet) {
      return;
    }

    const timer = window.setTimeout(() => {
      void handleSyncBackend({ silent: true });
    }, 650);

    return () => window.clearTimeout(timer);
  }, [snippets, user, accessToken, mergeMode]);

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
          <span className="ml-3 hidden text-[11px] text-muted-foreground sm:inline">
            cURL → Python
          </span>
        </div>

        <div className="flex items-center gap-2">
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

          <button
            onClick={() => setOptionsOpen((s) => !s)}
            className={cn(
              "flex items-center gap-1.5 rounded-sm border border-border bg-transparent px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground",
              optionsOpen && "border-border-strong text-foreground"
            )}
            aria-expanded={optionsOpen}
          >
            <span>{client}{isAsync ? " · async" : ""}</span>
            <ChevronDown
              className={cn("h-3 w-3 transition-transform", optionsOpen && "rotate-180")}
              strokeWidth={2}
            />
          </button>

          <button
            onClick={handleCopyActive}
            disabled={!activePanelFilename}
            className="flex items-center gap-1.5 rounded-sm border border-border bg-transparent px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            title={activePanelFilename ? `Copy ${activePanelFilename}` : "Copy active file"}
          >
            {copiedAll ? (
              <span className="flex items-center gap-1.5 text-success">
                <Check className="h-3 w-3 animate-check-in" strokeWidth={2.5} /> Copied
              </span>
            ) : (
              <>
                <Copy className="h-3 w-3" strokeWidth={2} />
                Copy
              </>
            )}
          </button>

          <button
            onClick={handleDownloadActive}
            disabled={!activePanelFilename}
            className="flex items-center gap-1.5 rounded-sm border border-border bg-transparent px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            title={activePanelFilename ? `Download ${activePanelFilename}` : "Download active file"}
          >
            <Download className="h-3 w-3" strokeWidth={2} />
            Download
          </button>

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

          <button
            onClick={() => void handleSyncBackend()}
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
              Login / Signup
            </Link>
          )}
        </div>
      </header>

      {/* OPTIONS */}
      {optionsOpen && (
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
      )}

      {/* MAIN */}
      <div className="flex flex-1 min-h-0">
        {/* SIDEBAR */}
        {sidebarOpen && (
          <aside className="flex w-48 shrink-0 flex-col border-r border-border bg-surface">
            <div className="flex h-8 items-center justify-between border-b border-border px-3">
              <span className="label-eyebrow">COLLECTION</span>
              <span className="text-[10px] text-muted-foreground">tmp</span>
            </div>

            <div className="flex-1 overflow-y-auto py-1.5 scrollbar-thin">
              {blocks.length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-muted-foreground">
                  No snippets yet
                </div>
              ) : (
                blocks.map((b, i) => {
                  const isActiveWorkspace = activeWorkspaceId === b.id;
                  const isExpanded = expandedWorkspaceIds.has(b.id) || isActiveWorkspace;
                  const hasError = !b.raw.trim() || !!b.parsed.error;
                  const method = (b.parsed.method || "GET").toUpperCase();
                  const files: WorkspaceFile[] = ["request.py", "parser.py", "response.json"];
                  return (
                    <div key={b.id} className="border-l-2 border-transparent">
                      <button
                        onClick={() => toggleWorkspace(b.id)}
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
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={2} />
                        ) : (
                          <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={2} />
                        )}
                        <span className={cn(
                          "shrink-0 text-[9px] font-semibold uppercase tracking-wider",
                          hasError ? "text-destructive" : "text-syntax-function"
                        )}>
                          {method.slice(0, 4)}
                        </span>
                        <span className="truncate">{effectiveNames[i]}</span>
                      </button>

                      {isExpanded && (
                        <div className="ml-3 border-l border-border/70 py-1">
                          {files.map((file) => {
                            const isSelected = activeWorkspaceId === b.id && activeWorkspaceFile === file;
                            return (
                              <button
                                key={file}
                                onClick={() => openWorkspaceFile(b.id, file)}
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
                })
              )}

              {mergeMode && validBlocks.length > 0 && (
                <>
                  <div className="mt-3 px-3 py-1 text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70">Merged</div>
                  <button
                    onClick={() => { setActiveTabId("merged"); setClosedTabIds((p) => { const n = new Set(p); n.delete("merged"); return n; }); }}
                    className={cn(
                      "flex w-full items-center gap-2 border-l-2 px-3 py-1.5 text-left text-[11px] font-mono transition-colors",
                      activeTab?.id === "merged"
                        ? "border-primary bg-primary/[0.07] text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-surface-elevated hover:text-foreground"
                    )}
                  >
                    <FileCode className="h-3 w-3 shrink-0" strokeWidth={2} />
                    <span className="truncate">generated_script.py</span>
                  </button>
                  <button
                    onClick={() => { setActiveTabId("parser"); setClosedTabIds((p) => { const n = new Set(p); n.delete("parser"); return n; }); }}
                    className={cn(
                      "flex w-full items-center gap-2 border-l-2 px-3 py-1.5 text-left text-[11px] font-mono transition-colors",
                      activeTab?.id === "parser"
                        ? "border-primary bg-primary/[0.07] text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-surface-elevated hover:text-foreground"
                    )}
                  >
                    <FileCode className="h-3 w-3 shrink-0" strokeWidth={2} />
                    <span className="truncate">parser.py</span>
                  </button>
                </>
              )}
            </div>

            <div className="flex items-center gap-1 border-t border-border p-2">
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
            </div>
          </aside>
        )}

        {/* MAIN SPLIT */}
        <main
          ref={mainRef}
          style={{ ["--split-left" as any]: `${dividerPos}%` }}
          className="relative grid flex-1 min-h-0 grid-cols-1 overflow-hidden md:[grid-template-columns:var(--split-left)_1px_minmax(0,1fr)]"
        >
          {/* LEFT — SNIPPET INPUT */}
          <section
            className="flex min-h-0 min-w-0 flex-col border-b border-border md:border-b-0"
          >
            <PanelHeader label="INPUT" right={
              <span className="text-[10px] text-muted-foreground">
                {snippets.length > 0 ? `${snippets.length} snippet${snippets.length === 1 ? "" : "s"}` : "—"}
              </span>
            } />

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-thin">
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
                            {/* Curl textarea — auto-expand, auto-collapse on paste */}
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

          {/* RIGHT — OUTPUT */}
          <section ref={outputRef} className="flex min-h-0 min-w-0 flex-col">
           

            <div className="flex items-center gap-0 overflow-x-auto border-b border-border bg-surface scrollbar-thin">
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
                          onClick={() => setActiveTabId(t.id)}
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
                    <MetaRow tab={activeTab} blocks={blocks} names={effectiveNames} />

                    <div className="relative min-h-0 flex-1 overflow-auto">
                      {activeWorkspaceFile !== "parser.py" && activeTab.hasError && activeTab.kind === "request" ? (
                        <div className="m-3 rounded-sm border border-destructive/40 bg-destructive/5 p-3 text-[12px] text-destructive">
                          Issue in {effectiveNames[activeTab.reqIdx ?? 0]}
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {blocks[activeTab.reqIdx ?? 0]?.parsed.error || "Empty snippet — paste a curl command"}
                          </div>
                        </div>
                      ) : (
                        <pre className="px-4 py-3">
                          <HighlightedPython code={activeCodeContent} />
                        </pre>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : activePanelTab === "response" ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex items-center gap-3 border-b border-border bg-background px-4 py-1.5 font-mono text-[11px]">
                  <span className="font-semibold text-primary">Status</span>
                  <span className="text-muted-foreground">{activeMeta?.status ?? "—"}</span>
                  <span className="text-syntax-comment">|</span>
                  <span className="font-semibold text-primary">Time</span>
                  <span className="text-muted-foreground">{activeMeta ? `${activeMeta.time_ms ?? activeMeta.time ?? 0}ms` : "—"}</span>
                  <span className="text-syntax-comment">|</span>
                  <span className="font-semibold text-primary">Size</span>
                  <span className="text-muted-foreground">{activeMeta?.size ?? "—"}</span>
                </div>
                <div className="relative min-h-0 flex-1 overflow-auto">
                  {activeResponseJson ? (
                    <pre className="px-4 py-3 font-mono text-[12px] leading-[1.6] text-foreground">
                      {activeResponseJson}
                    </pre>
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

// ───────────────────── helpers ─────────────────────

function PanelHeader({ label, right }: { label: string; right?: React.ReactNode }) {
  return (
    <div className="flex h-8 items-center justify-between border-b border-border bg-surface px-3">
      <span className="label-eyebrow">{label}</span>
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

function MetaRow({ tab, blocks, names }: { tab: OutputTab; blocks: SnippetBlock[]; names: string[] }) {
  if (tab.kind === "merged") {
    const valid = blocks.filter((b) => b.raw.trim() && !b.parsed.error).length;
    return (
      <div className="flex items-center gap-2 border-b border-border bg-background px-4 py-1.5 font-mono text-[11px]">
        <span className="font-semibold text-primary">MULTI</span>
        <span className="text-syntax-comment">|</span>
        <span className="text-foreground">{valid} snippet{valid === 1 ? "" : "s"}</span>
        <span className="text-syntax-comment">|</span>
        <span className="text-muted-foreground">Combined Script</span>
      </div>
    );
  }
  if (tab.kind === "parser") {
    return (
      <div className="flex items-center gap-2 border-b border-border bg-background px-4 py-1.5 font-mono text-[11px]">
        <span className="font-semibold text-syntax-function">PARSER</span>
        <span className="text-syntax-comment">|</span>
        <span className="text-muted-foreground">Auto-generated</span>
      </div>
    );
  }
  const idx = tab.reqIdx ?? 0;
  const parsed = blocks[idx]?.parsed;
  if (!parsed || parsed.error) return null;
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
