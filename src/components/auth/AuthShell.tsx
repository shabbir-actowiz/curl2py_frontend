import { ShieldCheck } from "lucide-react";
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

export function SocialButtons({ onClick }: { onClick?: (provider: "google") => void }) {
  return (
    <div className="grid grid-cols-1 gap-2.5">
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
