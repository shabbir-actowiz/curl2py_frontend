import { useEffect, useRef, useState } from "react";
import { Activity, Clipboard, Loader2, Play, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  cancelFeasibilityTest,
  extractApiErrorMessage,
  getFeasibilityTest,
  startFeasibilityTest,
  type FeasibilityArtifact,
  type FeasibilityTestStatus,
} from "@/lib/api";
import type { ParsedCurl } from "@/lib/curl-to-python";
import { FeasibilityConsole } from "./FeasibilityConsole";

interface ProxyConfig {
  enabled: boolean;
  url: string;
}

interface FeasibilityTesterProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collectionName: string;
  workspaceName: string;
  request: ParsedCurl | null;
  userProxy: ProxyConfig;
  onArtifacts: (artifacts: FeasibilityArtifact[]) => void;
}

const buttonClass = "inline-flex h-7 items-center justify-center gap-1.5 rounded-sm border border-border bg-background/40 px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45";

export function FeasibilityTester({
  open,
  onOpenChange,
  collectionName,
  workspaceName,
  request,
  userProxy,
  onArtifacts,
}: FeasibilityTesterProps) {
  const [result, setResult] = useState<FeasibilityTestStatus | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [testId, setTestId] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [testUserProxy, setTestUserProxy] = useState(false);
  const [productionLike, setProductionLike] = useState(true);
  const [politeDelay, setPoliteDelay] = useState(true);
  const [delayMinMs, setDelayMinMs] = useState(200);
  const [delayMaxMs, setDelayMaxMs] = useState(500);
  const [contentMarker, setContentMarker] = useState("");
  const [debuggingMode, setDebuggingMode] = useState(false);
  const artifactTestIdRef = useRef("");

  useEffect(() => {
    if (!testId || !isRunning) return;
    let disposed = false;
    const refresh = async () => {
      try {
        const next = await getFeasibilityTest(testId);
        if (disposed) return;
        setResult(next);
        setLogs(next.logs);
        if (next.status === "completed" || next.status === "cancelled" || next.status === "failed") {
          setIsRunning(false);
          if (next.status === "completed" && artifactTestIdRef.current !== next.test_id) {
            artifactTestIdRef.current = next.test_id;
            onArtifacts(next.artifacts);
            toast.success("Feasibility report files added to the selected request");
          }
          if (next.status === "failed") toast.error(next.error || "Feasibility test failed");
        }
      } catch (error) {
        if (disposed) return;
        setIsRunning(false);
        toast.error(extractApiErrorMessage(error));
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 700);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [isRunning, onArtifacts, testId]);

  const handleRun = async () => {
    if (isRunning) return;
    if (!request?.url || request.error) {
      toast.error("Select a valid request before starting the feasibility test");
      return;
    }
    try {
      setResult(null);
      setLogs([`[${new Date().toLocaleTimeString()}] Preparing feasibility test for ${workspaceName}`]);
      const started = await startFeasibilityTest({
        collection_name: collectionName,
        workspace_name: workspaceName,
        request: {
          url: request.url,
          method: request.method,
          headers: request.headers,
          body: request.data,
          timeout_seconds: 10,
          content_marker: contentMarker.trim() || null,
        },
        user_proxy: userProxy,
        test_user_proxy: testUserProxy && userProxy.enabled && !!userProxy.url.trim(),
        production_like: productionLike,
        polite_delay_enabled: productionLike && politeDelay,
        polite_delay_min_ms: delayMinMs,
        polite_delay_max_ms: delayMaxMs,
        normal_request_retries: productionLike ? 2 : 0,
        debugging_mode: debuggingMode,
      });
      setTestId(started.test_id);
      setIsRunning(true);
    } catch (error) {
      toast.error(extractApiErrorMessage(error));
    }
  };

  const handleCancel = async () => {
    if (!testId || !isRunning) return;
    try {
      const next = await cancelFeasibilityTest(testId);
      setResult(next);
      setLogs(next.logs);
    } catch (error) {
      toast.error(extractApiErrorMessage(error));
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(logs.join("\n"));
    toast.success("Feasibility logs copied");
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !isRunning && onOpenChange(next)}>
      <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col gap-3 overflow-hidden p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Activity className="h-4 w-4 text-primary" />
            Feasibility Tester
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-3 border border-border bg-surface px-3 py-2 font-mono text-[11px]">
          <span className="text-muted-foreground">Request</span>
          <span className="font-semibold text-foreground">{workspaceName}</span>
          <span className="text-syntax-comment">|</span>
          <span className="text-syntax-function">{request?.method || "-"}</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{request?.url || "Select a request"}</span>
          {userProxy.enabled && userProxy.url.trim() && (
            <label className="flex items-center gap-1.5 text-muted-foreground">
              <input type="checkbox" checked={testUserProxy} onChange={(event) => setTestUserProxy(event.target.checked)} disabled={isRunning} />
              Test with user proxy
            </label>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 border border-border bg-surface px-3 py-2 font-mono text-[11px] text-muted-foreground">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={productionLike} onChange={(event) => setProductionLike(event.target.checked)} disabled={isRunning} />
            Production-like test
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={politeDelay} onChange={(event) => setPoliteDelay(event.target.checked)} disabled={isRunning || !productionLike} />
            Polite Delay
          </label>
          <label className="flex items-center gap-1">
            Min ms
            <input className="h-6 w-16 border border-border bg-background px-1 text-foreground" type="number" min={0} max={5000} value={delayMinMs} onChange={(event) => setDelayMinMs(Number(event.target.value))} disabled={isRunning || !productionLike || !politeDelay} />
          </label>
          <label className="flex items-center gap-1">
            Max ms
            <input className="h-6 w-16 border border-border bg-background px-1 text-foreground" type="number" min={0} max={5000} value={delayMaxMs} onChange={(event) => setDelayMaxMs(Number(event.target.value))} disabled={isRunning || !productionLike || !politeDelay} />
          </label>
          <label className="flex min-w-[220px] flex-1 items-center gap-1">
            Content marker
            <input className="h-6 min-w-0 flex-1 border border-border bg-background px-1 text-foreground" value={contentMarker} onChange={(event) => setContentMarker(event.target.value)} placeholder="Optional required text" disabled={isRunning} />
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={debuggingMode} onChange={(event) => setDebuggingMode(event.target.checked)} disabled={isRunning} />
            Debugging mode
          </label>
        </div>

        {result?.summary && (
          <div className="grid grid-cols-2 gap-px border border-border bg-border text-[11px] md:grid-cols-4">
            {[
              ["Feasibility", result.summary.feasibility],
              ["Recommended route", result.summary.recommended_route],
              ["Recommended Workers", result.summary.recommended_workers],
              ["Next tested stage", result.summary.next_tested_stage || "-"],
              ["Failure reason", result.summary.next_stage_failure_reason || "-"],
              ["Recommendation", result.summary.recommendation || "-"],
              ["Max Tested Requests", String(result.summary.max_tested_total_requests)],
              ["Block risk", result.summary.block_risk],
              ["Data available", result.summary.data_availability ? "Yes" : "No"],
              ["Parser possible", result.summary.parser_possible ? "Yes" : "No"],
            ].map(([label, value]) => (
              <div key={label} className="bg-background px-3 py-2">
                <div className="text-muted-foreground">{label}</div>
                <div className="mt-1 font-mono text-foreground">{value}</div>
              </div>
            ))}
          </div>
        )}

        {!!result?.route_results.length && (
          <div className="overflow-auto border border-border">
            <table className="w-full text-left font-mono text-[10px]">
              <thead className="bg-surface text-muted-foreground">
                <tr>
                  {["Route", "2 Workers / 500 Requests", "Recommended Workers", "Max Tested Workers", "Failed Stage", "Managed Route Stability"].map((label) => <th key={label} className="border-b border-border px-2 py-1.5 font-medium">{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {result.route_results.map((route) => (
                  <tr key={route.route} className="border-b border-border/60">
                    <td className="px-2 py-1.5">{route.route}</td>
                    <td className="px-2 py-1.5">{route.warmup_passed ? "Passed" : "Failed"}</td>
                    <td className="px-2 py-1.5">{route.highest_stable_workers}</td>
                    <td className="px-2 py-1.5">{route.max_tested_workers}</td>
                    <td className="px-2 py-1.5">{route.unstable_worker_stage || "-"}</td>
                    <td className="px-2 py-1.5">{route.managed_route_stability}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto border border-border">
          <table className="w-full text-left font-mono text-[10px]">
            <thead className="sticky top-0 bg-surface text-muted-foreground">
              <tr>
                {["Route", "Phase", "Total Requests", "Max Workers", "Success Rate", "HTTP Success", "Content Valid", "Retry Recovered", "Final Failed", "Req/sec", "Avg ms", "Timeouts", "403", "429", "High Blocks", "Keyword Confidence L/M/H", "Route Retries", "Avg Attempts", "Failed After 5", "Classification", "Managed Stability", "Result"].map((label) => <th key={label} className="border-b border-border px-2 py-1.5 font-medium">{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {result?.stage_metrics.length ? result.stage_metrics.map((stage, index) => (
                <tr key={`${stage.route}-${stage.phase}-${stage.total_requests}-${stage.max_workers}-${index}`} className="border-b border-border/60">
                  <td className="px-2 py-1.5">{stage.route}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{stage.phase}</td>
                  <td className="px-2 py-1.5">{stage.total_requests}</td>
                  <td className="px-2 py-1.5">{stage.max_workers}</td>
                  <td className="px-2 py-1.5">{stage.success_count}/{stage.total_requests} ({stage.success_percentage}%)</td>
                  <td className="px-2 py-1.5">{stage.http_success_count}</td>
                  <td className="px-2 py-1.5">{stage.content_valid_success_count}</td>
                  <td className="px-2 py-1.5">{stage.retry_recovered_count}</td>
                  <td className="px-2 py-1.5">{stage.final_failed_count}</td>
                  <td className="px-2 py-1.5">{stage.requests_per_second.toFixed(1)}</td>
                  <td className="px-2 py-1.5">{Math.round(stage.average_response_time_ms)}</td>
                  <td className="px-2 py-1.5">{stage.timeout_count}</td>
                  <td className="px-2 py-1.5">{stage.status_403_count}</td>
                  <td className="px-2 py-1.5">{stage.status_429_count}</td>
                  <td className="px-2 py-1.5">{stage.block_detection_count}</td>
                  <td className="px-2 py-1.5">{stage.low_confidence_block_count}/{stage.medium_confidence_block_count}/{stage.high_confidence_block_count}</td>
                  <td className="px-2 py-1.5">{stage.route_retry_count}</td>
                  <td className="px-2 py-1.5">{stage.avg_route_attempts_per_request.toFixed(2)}</td>
                  <td className="px-2 py-1.5">{stage.requests_failed_after_5_attempts}</td>
                  <td className="px-2 py-1.5">{stage.stability_classification}</td>
                  <td className="px-2 py-1.5">{stage.managed_route_stability}</td>
                  <td className={stage.acceptable ? "px-2 py-1.5 text-primary" : "px-2 py-1.5 text-destructive"}>{stage.acceptable ? "pass" : stage.stop_reason}</td>
                </tr>
              )) : (
                <tr><td colSpan={22} className="px-3 py-4 text-center text-muted-foreground">Stage metrics appear as each phase completes.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <FeasibilityConsole logs={logs} />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-mono text-[10px] text-muted-foreground">
            {isRunning ? `${result?.current_route || "Starting"} | ${result?.current_phase || "queued"}${result?.current_stage ? ` | ${result.current_stage} total requests` : ""}${result?.current_max_workers ? ` | ${result.current_max_workers} max workers` : ""}` : result?.status || "Ready"}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={buttonClass} onClick={() => setLogs([])}><Trash2 className="h-3 w-3" />Clear console</button>
            <button className={buttonClass} onClick={() => void handleCopy()} disabled={!logs.length}><Clipboard className="h-3 w-3" />Copy logs</button>
            <button className={buttonClass} onClick={() => void handleCancel()} disabled={!isRunning}><X className="h-3 w-3" />Cancel test</button>
            <button className={buttonClass} onClick={() => void handleRun()} disabled={isRunning || !request?.url}>
              {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              {isRunning ? "Running..." : "Run test"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
