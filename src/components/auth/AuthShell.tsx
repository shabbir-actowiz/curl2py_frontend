import { ShieldCheck } from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";
import favicon from "/favicon-32x32.png";
export function BrandLogo() {
  return (
    <div className="flex items-center justify-center gap-2 font-mono text-[15px] tracking-tight">
      <img src={favicon} alt="logo" className="mr-0 h-7 w-7" />
          <h1 className="m-0 p-0 text-[19px] font-semibold leading-none tracking-tight">
            <span className="text-primary">curl</span>
            <span className="text-muted-foreground">2</span>
            <span className="text-foreground">py</span>
          </h1>
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

export function SocialButtons({
  onCredential,
  onError,
}: {
  onCredential?: (credential: string) => void;
  onError?: (message: string) => void;
}) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
    if (!clientId) {
      onError?.("Google login is not configured.");
      return;
    }

    const renderButton = () => {
      const google = (window as any).google;
      if (!buttonRef.current || !google?.accounts?.id) {
        onError?.("Google login could not load.");
        return;
      }

      buttonRef.current.innerHTML = "";
      google.accounts.id.initialize({
        client_id: clientId,
        callback: (response: { credential?: string }) => {
          if (response.credential) onCredential?.(response.credential);
        },
      });
      const width = Math.max(220, Math.min(400, buttonRef.current.getBoundingClientRect().width || 400));
      google.accounts.id.renderButton(buttonRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "rectangular",
        width,
      });
      setIsReady(true);
    };

    window.addEventListener("resize", renderButton);

    if ((window as any).google?.accounts?.id) {
      renderButton();
      return () => window.removeEventListener("resize", renderButton);
    }

    const existingScript = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (existingScript) {
      existingScript.addEventListener("load", renderButton, { once: true });
      return () => {
        existingScript.removeEventListener("load", renderButton);
        window.removeEventListener("resize", renderButton);
      };
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = renderButton;
    script.onerror = () => onError?.("Google login could not load.");
    document.head.appendChild(script);
    return () => window.removeEventListener("resize", renderButton);
  }, [onCredential, onError]);

  return (
    <div className="grid grid-cols-1 gap-2.5">
      <div ref={buttonRef} className="flex min-h-10 w-full items-center justify-center overflow-hidden" />
      {!isReady && (
        <div className="flex h-10 items-center justify-center rounded-md border border-border bg-transparent text-[13px] text-muted-foreground">
          Loading Google login
        </div>
      )}
    </div>
  );
}
