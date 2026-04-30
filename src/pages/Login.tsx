import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { User, Lock, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { AuthShell, Divider, SocialButtons } from "@/components/auth/AuthShell";
import { extractApiErrorMessage } from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";

export default function Login() {
  const navigate = useNavigate();
  const { login, user, isLoading } = useAuth();
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoading && user) {
      navigate("/");
    }
  }, [isLoading, navigate, user]);

  return (
    <AuthShell>
      <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
        <header className="mb-5 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">Login to your account</p>
        </header>

        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!username.trim() || !password) {
              setError("Enter your username and password.");
              return;
            }

            setError("");
            try {
              setIsSubmitting(true);
              const signedIn = await login({ username: username.trim(), password }, { remember });
              toast.success(`Signed in as ${signedIn.username}`);
              navigate("/");
            } catch (submitError) {
              const message = extractApiErrorMessage(submitError);
              setError(message);
              toast.error(message);
            } finally {
              setIsSubmitting(false);
            }
          }}
        >
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-foreground" htmlFor="username">Username</label>
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="your-handle"
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
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="h-10 w-full rounded-md bg-primary text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Signing in..." : "Login"}
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
