export type LogSeverity = "success" | "info" | "warning" | "error";

export function getLogSeverity(line: string): LogSeverity {
  const lower = line.toLowerCase();
  const hasPositiveFailureCount = /\b(?:final failed|failed):?\s+[1-9]\d*\b/.test(lower);

  if (lower.includes(" progress ")) {
    return "info";
  }

  if (
    lower.includes("burst failure detected")
    || lower.includes("stop rule triggered")
    || lower.includes("content validation failed")
    || lower.includes("final failed result")
    || lower.includes("not feasible")
    || lower.includes("route failed")
    || /\bstage failed\b/.test(lower)
    || /\bfailed after\b/.test(lower)
    || hasPositiveFailureCount
  ) {
    return "error";
  }

  if (
    lower.includes("stage passed")
    || lower.includes("validation passed")
    || lower.includes("managed route succeeded")
    || lower.includes("recommended workers")
    || lower.includes("final result: feasible")
    || lower.includes("final result: highly feasible")
  ) {
    return "success";
  }

  if (
    lower.includes("retrying")
    || lower.includes("recovered on retry")
    || lower.includes("retry recovered")
    || lower.includes("medium risk")
    || lower.includes("potential block")
    || lower.includes("elevated retry")
    || lower.includes("managed route attempt")
  ) {
    return "warning";
  }

  return "info";
}

export function severityClass(severity: LogSeverity): string {
  if (severity === "success") return "text-success";
  if (severity === "warning") return "text-amber-400";
  if (severity === "error") return "text-destructive";
  return "text-muted-foreground";
}

export function metricClass(label: string, value: number): string {
  if (label.toLowerCase().includes("retry")) return value > 0 ? "text-amber-400" : "text-muted-foreground";
  if (label.toLowerCase().includes("failed")) return value > 0 ? "text-destructive" : "text-muted-foreground";
  return value > 0 ? "text-success" : "text-muted-foreground";
}
