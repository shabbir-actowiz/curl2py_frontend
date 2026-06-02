import { useEffect, useRef } from "react";
import { getLogSeverity, metricClass, severityClass } from "./console-severity";

interface FeasibilityConsoleProps {
  logs: string[];
}

const metricPattern = /(final success|success|retry recovered|final failed|failed):?\s+(\d+)/gi;

function renderLogLine(line: string) {
  const parts = line.split(metricPattern);
  if (parts.length === 1) return line;

  return parts.map((part, index) => {
    if (index % 3 === 0) return part;
    const label = part;
    const value = Number(parts[index + 1]);
    return (
      <span key={`${index}-${part}`} className={metricClass(label, value)}>
        {label} {value}
      </span>
    );
  }).filter((_, index) => index % 3 !== 2);
}

export function FeasibilityConsole({ logs }: FeasibilityConsoleProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [logs]);

  return (
    <div className="h-52 overflow-auto border border-border bg-background px-3 py-2 font-mono text-[11px] leading-5">
      {logs.length ? logs.map((line, index) => {
        const severity = getLogSeverity(line);
        return <div key={`${index}-${line}`} className={severityClass(severity)}>{renderLogLine(line)}</div>;
      }) : <div className="text-muted-foreground">Console ready. Start a test to see live progress.</div>}
      <div ref={endRef} />
    </div>
  );
}
