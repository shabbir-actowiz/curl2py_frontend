import { useState } from "react";
import { Link } from "react-router-dom";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
import { AuthShell, Divider, SocialButtons } from "@/components/auth/AuthShell";

export default function Login() {
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(true);

  return (
    <AuthShell>
      <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
        <header className="mb-5 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">Login to your account</p>
        </header>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-foreground" htmlFor="email">Email</label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
              <input
                id="email"
                type="email"
                placeholder="you@example.com"
                className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-[13px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/60 focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-foreground" htmlFor="password">Password</label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
              <input
                id="password"
                type={showPwd ? "text" : "password"}
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
          </div>

          <div className="flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted-foreground">
              <button
                type="button"
                role="checkbox"
                aria-checked={remember}
                onClick={() => setRemember((r) => !r)}
                className={`flex h-4 w-4 items-center justify-center rounded-sm border ${remember ? "border-primary bg-primary" : "border-border bg-transparent"}`}
              >
                {remember && (
                  <svg viewBox="0 0 16 16" className="h-3 w-3 text-primary-foreground" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
              <span onClick={() => setRemember((r) => !r)}>Remember me</span>
            </label>
            <Link to="#" className="text-[12px] text-primary hover:underline">Forgot password?</Link>
          </div>

          <button
            type="submit"
            className="h-10 w-full rounded-md bg-primary text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Login
          </button>
        </form>

        <Divider label="or continue with" />
        <SocialButtons />

        <p className="mt-5 text-center text-[12px] text-muted-foreground">
          Don't have an account?{" "}
          <Link to="/register" className="text-primary hover:underline">Sign up</Link>
        </p>
      </div>
    </AuthShell>
  );
}
