import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mail, Lock, Eye, EyeOff, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth/AuthShell";
import { extractApiErrorMessage, forgotPassword, verifyOTP, resetPassword } from "@/lib/api";

type Step = "email" | "otp" | "password";

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);

  // Handle sending OTP
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError("Please enter your email address");
      return;
    }

    setError("");
    try {
      setIsLoading(true);
      const response = await forgotPassword({ email: email.trim() });
      toast.success("OTP sent to your email!");
      setOtpSent(true);
      setStep("otp");
      setResendCountdown(60);
      
      // Countdown timer for resend
      const interval = setInterval(() => {
        setResendCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      const message = extractApiErrorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle OTP verification
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp.trim()) {
      setError("Please enter the OTP");
      return;
    }

    if (otp.length !== 6 || !/^\d+$/.test(otp)) {
      setError("OTP must be 6 digits");
      return;
    }

    setError("");
    try {
      setIsLoading(true);
      await verifyOTP({ email: email.trim(), otp: otp.trim() });
      toast.success("OTP verified successfully!");
      setStep("password");
    } catch (err) {
      const message = extractApiErrorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle password reset
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!password.trim()) {
      setError("Please enter a new password");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setError("");
    try {
      setIsLoading(true);
      await resetPassword({
        email: email.trim(),
        otp: otp.trim(),
        password: password.trim(),
      });
      toast.success("Password reset successfully!");
      navigate("/login");
    } catch (err) {
      const message = extractApiErrorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell>
      <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
        {/* Header */}
        <header className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Reset Password</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {step === "email" && "Enter your email to receive an OTP"}
            {step === "otp" && "Enter the OTP sent to your email"}
            {step === "password" && "Create a new password"}
          </p>
        </header>

        {/* Step 1: Email */}
        {step === "email" && (
          <form onSubmit={handleSendOtp} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-foreground" htmlFor="email">
                Email Address
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-[13px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/60 focus:ring-1 focus:ring-primary/30"
                />
              </div>
            </div>

            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="h-10 w-full rounded-md bg-primary text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending OTP...
                </span>
              ) : (
                "Send OTP"
              )}
            </button>
          </form>
        )}

        {/* Step 2: OTP Verification */}
        {step === "otp" && (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-foreground" htmlFor="otp">
                Enter OTP Code
              </label>
              <p className="text-[12px] text-muted-foreground">
                We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>
              </p>
              <input
                id="otp"
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                className="h-12 w-full rounded-md border border-border bg-background px-3 text-center text-2xl font-semibold tracking-widest outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/60 focus:ring-1 focus:ring-primary/30"
              />
            </div>

            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isLoading || otp.length !== 6}
              className="h-10 w-full rounded-md bg-primary text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verifying...
                </span>
              ) : (
                "Verify OTP"
              )}
            </button>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setOtp("");
                  setError("");
                }}
                className="flex items-center gap-1 text-[12px] text-primary hover:underline"
              >
                <ArrowLeft className="h-3 w-3" />
                Change email
              </button>
              <button
                type="button"
                onClick={handleSendOtp}
                disabled={resendCountdown > 0 || isLoading}
                className="text-[12px] text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resendCountdown > 0 ? `Resend in ${resendCountdown}s` : "Resend OTP"}
              </button>
            </div>
          </form>
        )}

        {/* Step 3: Password Reset */}
        {step === "password" && (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-foreground" htmlFor="password">
                New Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-10 text-[13px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/60 focus:ring-1 focus:ring-primary/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" strokeWidth={1.75} /> : <Eye className="h-4 w-4" strokeWidth={1.75} />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-foreground" htmlFor="confirmPassword">
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your password"
                  className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-10 text-[13px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/60 focus:ring-1 focus:ring-primary/30"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((s) => !s)}
                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" strokeWidth={1.75} /> : <Eye className="h-4 w-4" strokeWidth={1.75} />}
                </button>
              </div>
            </div>

            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="h-10 w-full rounded-md bg-primary text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Resetting...
                </span>
              ) : (
                "Reset Password"
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep("otp");
                setPassword("");
                setConfirmPassword("");
                setError("");
              }}
              className="flex w-full items-center justify-center gap-1 text-[12px] text-primary hover:underline"
            >
              <ArrowLeft className="h-3 w-3" />
              Back to OTP verification
            </button>
          </form>
        )}

        {/* Footer */}
        <p className="mt-6 text-center text-[12px] text-muted-foreground">
          Remember your password?{" "}
          <Link to="/login" className="text-primary hover:underline">
            Back to login
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
