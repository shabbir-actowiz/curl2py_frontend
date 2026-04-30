import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Mail, Lock, User, Eye, EyeOff } from "lucide-react";
import { AuthShell, Divider, SocialButtons } from "@/components/auth/AuthShell";

function scorePassword(pw: string): { score: 0 | 1 | 2 | 3; label: string } {
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  if (pw.length === 0) return { score: 0, label: "" };
  if (s <= 1) return { score: 1, label: "Weak" };
  if (s === 2) return { score: 2, label: "Medium" };
  return { score: 3, label: "Strong" };
}

export default function Register() {
  const [showPwd, setShowPwd] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [pwd, setPwd] = useState("");
  const strength = useMemo(() => scorePassword(pwd), [pwd]);

  const segColor = (i: number) => {
    if (strength.score >= i) {
      if (strength.score === 1) return "bg-destructive/70";
      if (strength.score === 2) return "bg-yellow-500/70";
      return "bg-primary";
    }
    return "bg-border";
  };

  return (
    <AuthShell>
      <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
        <header className="mb-5 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Create account</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">Sign up to get started</p>
        </header>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" htmlFor="name">Name</label>
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
              <input
                id="name"
                type="text"
                placeholder="Your name"
                className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-[13px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/60 focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" htmlFor="r-email">Email</label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
              <input
                id="r-email"
                type="email"
                placeholder="you@example.com"
                className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-[13px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/60 focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" htmlFor="r-pwd">Password</label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
              <input
                id="r-pwd"
                type={showPwd ? "text" : "password"}
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                placeholder="••••••••"
                className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-10 text-[13px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/60 focus:ring-1 focus:ring-primary/30"
              />
              <button
                type="button"
                onClick={() => setShowPwd((s) => !s)}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                aria-label={showPwd ? "Hide password" : "Show password"}
              >
                {showPwd ? <EyeOff className="h-4 w-4" strokeWidth={1.75} /> : <Eye className="h-4 w-4" strokeWidth={1.75} />}
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="flex flex-1 gap-1">
                <div className={`h-1 flex-1 rounded-full transition-colors ${segColor(1)}`} />
                <div className={`h-1 flex-1 rounded-full transition-colors ${segColor(2)}`} />
                <div className={`h-1 flex-1 rounded-full transition-colors ${segColor(3)}`} />
              </div>
              <span
                className={`min-w-[48px] text-right text-[10.5px] ${
                  strength.score === 3
                    ? "text-primary"
                    : strength.score === 2
                      ? "text-yellow-500/90"
                      : strength.score === 1
                        ? "text-destructive/90"
                        : "text-muted-foreground"
                }`}
              >
                {strength.label}
              </span>
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-2 text-[12px] text-muted-foreground">
            <button
              type="button"
              role="checkbox"
              aria-checked={agreed}
              onClick={() => setAgreed((a) => !a)}
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${agreed ? "border-primary bg-primary" : "border-border bg-transparent"}`}
            >
              {agreed && (
                <svg viewBox="0 0 16 16" className="h-3 w-3 text-primary-foreground" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <span>
              I agree to the{" "}
              <a href="#" className="text-primary hover:underline">Terms of Service</a>{" "}
              and{" "}
              <a href="#" className="text-primary hover:underline">Privacy Policy</a>
            </span>
          </label>

          <button
            type="submit"
            disabled={!agreed}
            className="h-10 w-full rounded-md bg-primary text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Sign up
          </button>
        </form>

        <Divider label="or continue with" />
        <SocialButtons />

        <p className="mt-5 text-center text-[12px] text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="text-primary hover:underline">Login</Link>
        </p>
      </div>
    </AuthShell>
  );
}
