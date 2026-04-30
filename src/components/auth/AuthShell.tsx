import { ShieldCheck, TerminalSquare } from "lucide-react";
import { ReactNode } from "react";

export function BrandLogo() {
  return (
    <div className="flex items-center justify-center gap-2 font-mono text-[15px] tracking-tight">
      <span className="text-primary">&gt;_</span>
      <span>
        <span className="text-foreground">cur</span>
        <span className="text-primary">l2py</span>
      </span>
    </div>
  );
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6">
            <BrandLogo />
          </div>
          {children}
          <div className="mt-6 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary/80" strokeWidth={1.75} />
            Your data is encrypted and secure
          </div>
        </div>
      </main>
    </div>
  );
}

export function Divider({ label }: { label: string }) {
  return (
    <div className="my-5 flex items-center gap-3">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

export function SocialButtons({ onClick }: { onClick?: (provider: "github" | "google") => void }) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <button
        type="button"
        onClick={() => onClick?.("github")}
        className="flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-transparent text-[13px] text-foreground transition-colors hover:border-border-strong hover:bg-surface-elevated"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 .5C5.73.5.75 5.48.75 11.75c0 4.99 3.23 9.22 7.71 10.71.56.1.77-.24.77-.54 0-.27-.01-1.16-.02-2.11-3.14.68-3.8-1.34-3.8-1.34-.51-1.31-1.25-1.66-1.25-1.66-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.5-.29-5.13-1.25-5.13-5.57 0-1.23.44-2.24 1.16-3.03-.12-.29-.5-1.43.11-2.99 0 0 .95-.3 3.1 1.16.9-.25 1.86-.38 2.82-.38.96 0 1.92.13 2.82.38 2.15-1.46 3.1-1.16 3.1-1.16.61 1.56.23 2.7.11 2.99.72.79 1.16 1.8 1.16 3.03 0 4.33-2.64 5.28-5.15 5.56.4.35.76 1.03.76 2.08 0 1.5-.01 2.71-.01 3.08 0 .3.2.65.78.54 4.47-1.49 7.7-5.72 7.7-10.71C23.25 5.48 18.27.5 12 .5z" />
        </svg>
        GitHub
      </button>
      <button
        type="button"
        onClick={() => onClick?.("google")}
        className="flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-transparent text-[13px] text-foreground transition-colors hover:border-border-strong hover:bg-surface-elevated"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
          <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.74-6-6.1S8.7 6 12 6c1.88 0 3.14.8 3.86 1.49l2.63-2.54C16.84 3.43 14.62 2.5 12 2.5 6.76 2.5 2.5 6.76 2.5 12S6.76 21.5 12 21.5c6.93 0 9.5-4.86 9.5-7.4 0-.5-.05-.88-.12-1.27H12z" />
          <path fill="#34A853" d="M3.88 7.55l3.2 2.35C7.97 7.94 9.83 6 12 6c1.88 0 3.14.8 3.86 1.49l2.63-2.54C16.84 3.43 14.62 2.5 12 2.5 8.24 2.5 5 4.66 3.88 7.55z" opacity=".0" />
          <path fill="#FBBC05" d="M12 21.5c2.57 0 4.73-.85 6.3-2.31l-2.99-2.46c-.83.58-1.93.97-3.31.97-2.55 0-4.71-1.7-5.49-4.04l-3.16 2.44C4.86 19.4 8.13 21.5 12 21.5z" opacity=".0" />
          <path fill="#4285F4" d="M21.38 12.1c0-.5-.05-.88-.12-1.27H12v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1v3.27c3.87 0 7.14-2.1 9.38-5.4-.05-1.6 0-3.1 0-4.6z" opacity=".0" />
        </svg>
        Google
      </button>
    </div>
  );
}
