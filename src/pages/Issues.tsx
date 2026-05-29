import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { downloadIssueFile, extractApiErrorMessage, listIssues, listIssuesAdmin, resolveIssue, type Issue } from "@/lib/api";
import { cn } from "@/lib/utils";
import ImageViewer from "@/components/ImageViewer";
import ImageThumbnailGrid from "@/components/ImageThumbnailGrid";
import { useImageViewer } from "@/hooks/use-image-viewer";
import { extractImageFiles, isImageFile } from "@/lib/image-utils";
import { useAuth } from "@/contexts/auth-context";

type StatusFilter = "all" | "open" | "resolved";

interface TokenPayload {
  is_admin?: boolean;
  [key: string]: unknown;
}

function decodeToken(token: string): TokenPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    
    const decoded = atob(parts[1]);
    return JSON.parse(decoded) as TokenPayload;
  } catch {
    return null;
  }
}

export default function Issues({ admin = false }: { admin?: boolean }) {
  const navigate = useNavigate();
  const { accessToken } = useAuth();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selected, setSelected] = useState<Issue | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState("");
  const [downloadingFileKey, setDownloadingFileKey] = useState("");
  const imageViewer = useImageViewer();

  // Check admin access on mount and when admin prop changes
  useEffect(() => {
    if (admin && accessToken) {
      const decoded = decodeToken(accessToken);
      if (!decoded || !decoded.is_admin) {
        toast.error("You don't have permission to access this resource.");
        navigate("/", { replace: true });
      }
    }
  }, [admin, accessToken, navigate]);

  const loadIssues = async () => {
    try {
      setIsLoading(true);
      const loader = admin ? listIssuesAdmin : listIssues;
      const data = await loader({ q: q.trim(), status }, accessToken);
      setIssues(data);
      if (selected) {
        setSelected(data.find((issue) => issue.issue_id === selected.issue_id) ?? null);
      }
    } catch (error) {
      toast.error(extractApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadIssues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin, accessToken]);

  const handleResolve = async (issueId: string) => {
    try {
      setResolvingId(issueId);
      const updated = await resolveIssue(issueId, accessToken);
      setIssues((prev) => prev.map((issue) => issue.issue_id === issueId ? updated : issue));
      setSelected((current) => current?.issue_id === issueId ? updated : current);
      toast.success("Issue resolved");
    } catch (error) {
      toast.error(extractApiErrorMessage(error));
    } finally {
      setResolvingId("");
    }
  };

  const handleDownloadFile = async (issueId: string, fileIndex: number, filename: string) => {
    const fileKey = `${issueId}:${fileIndex}`;
    try {
      setDownloadingFileKey(fileKey);
      await downloadIssueFile(issueId, fileIndex, filename);
    } catch (error) {
      toast.error(extractApiErrorMessage(error));
    } finally {
      setDownloadingFileKey("");
    }
  };

  const handleOpenImageViewer = (issueId: string, startIndex = 0) => {
    const images = extractImageFiles(issueId, selected?.files || []);
    if (images.length > 0) {
      imageViewer.openViewer(images, startIndex);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 items-center justify-between border-b border-border bg-surface/70 px-4">
        <div className="font-mono text-[13px] font-semibold">{admin ? "Issues Admin" : "Issue Tracking"}</div>
        <Link to="/" className="rounded-sm border border-border bg-background/40 px-3 py-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground">
          Back
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 gap-4 p-4 font-mono">
        <section className="min-w-0 flex-1 rounded-sm border border-border bg-surface/35">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search issue ID, email, type, description"
              className="h-8 min-w-[260px] flex-1 rounded-sm border border-border bg-background px-2 text-[12px] outline-none focus:border-border-strong"
            />
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
              className="h-8 rounded-sm border border-border bg-background px-2 text-[12px] outline-none focus:border-border-strong"
            >
              <option value="all">all</option>
              <option value="open">open</option>
              <option value="resolved">resolved</option>
            </select>
            <button
              onClick={() => void loadIssues()}
              disabled={isLoading}
              className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-primary/60 bg-primary/10 px-3 text-[11px] text-primary hover:bg-primary/15 disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} /> : null}
              Search
            </button>
          </div>

          <div className="overflow-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Issue ID</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  {admin && <th className="px-3 py-2 font-medium">Action</th>}
                </tr>
              </thead>
              <tbody>
                {issues.map((issue) => (
                  <tr
                    key={issue.issue_id}
                    className={cn("cursor-pointer border-b border-border/70 hover:bg-surface-elevated", selected?.issue_id === issue.issue_id && "bg-primary/[0.07]")}
                    onClick={() => setSelected(issue)}
                  >
                    <td className="px-3 py-2 text-primary">{issue.issue_id}</td>
                    <td className="px-3 py-2">{issue.issue_type}</td>
                    <td className="px-3 py-2">{issue.status}</td>
                    <td className="px-3 py-2">{issue.email}</td>
                    <td className="px-3 py-2">{new Date(issue.created_at).toLocaleString()}</td>
                    {admin && (
                      <td className="px-3 py-2">
                        {issue.status === "open" ? (
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleResolve(issue.issue_id);
                            }}
                            disabled={resolvingId === issue.issue_id}
                            className="rounded-sm border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                          >
                            {resolvingId === issue.issue_id ? "Resolving..." : "Resolve"}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">{issue.resolved_at ? new Date(issue.resolved_at).toLocaleString() : "resolved"}</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {issues.length === 0 && (
                  <tr>
                    <td className="px-3 py-6 text-center text-muted-foreground" colSpan={admin ? 6 : 5}>
                      No issues found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="hidden w-80 shrink-0 rounded-sm border border-border bg-surface/35 p-3 text-[12px] lg:block overflow-y-auto">
          {selected ? (
            <div className="space-y-3">
              <div className="text-primary">{selected.issue_id}</div>
              <div><span className="text-muted-foreground">Type:</span> {selected.issue_type}</div>
              <div><span className="text-muted-foreground">Status:</span> {selected.status}</div>
              <div><span className="text-muted-foreground">Email:</span> {selected.email}</div>
              <div><span className="text-muted-foreground">Created:</span> {new Date(selected.created_at).toLocaleString()}</div>
              {selected.resolved_at && <div><span className="text-muted-foreground">Resolved:</span> {new Date(selected.resolved_at).toLocaleString()}</div>}
              <div>
                <div className="mb-1 text-muted-foreground">Description:</div>
                <div className="whitespace-pre-wrap rounded-sm border border-border bg-background p-2">{selected.description}</div>
              </div>

              {/* Image Preview Section */}
              {selected.files.some((f) => isImageFile(f.filename)) && (
                <div className="border-t border-border pt-3">
                  <ImageThumbnailGrid
                    images={extractImageFiles(selected.issue_id, selected.files)}
                    onSelectImage={(index) => handleOpenImageViewer(selected.issue_id, index)}
                    imageCount={selected.files.filter((f) => isImageFile(f.filename)).length}
                  />
                </div>
              )}

              {/* Files Section */}
              <div>
                <div className="mb-1 text-muted-foreground">Files:</div>
                {selected.files.length ? selected.files.map((file, index) => {
                  const fileIndex = typeof file.index === "number" ? file.index : index;
                  return (
                    <button
                      key={`${file.filename}-${file.size}-${fileIndex}`}
                      type="button"
                      onClick={() => void handleDownloadFile(selected.issue_id, fileIndex, file.filename)}
                      disabled={downloadingFileKey === `${selected.issue_id}:${fileIndex}`}
                      className="block text-left text-primary hover:text-foreground disabled:cursor-wait disabled:opacity-60"
                    >
                      {downloadingFileKey === `${selected.issue_id}:${fileIndex}` ? "Downloading..." : `${file.filename} (${file.size} bytes)`}
                    </button>
                  );
                }) : <div className="text-muted-foreground">No files</div>}
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground">Select an issue to view details.</div>
          )}
        </aside>
      </main>

      {/* Image Viewer Modal */}
      {imageViewer.isOpen && (
        <ImageViewer
          images={imageViewer.images}
          initialIndex={imageViewer.selectedIndex}
          onClose={imageViewer.closeViewer}
        />
      )}
    </div>
  );
}
