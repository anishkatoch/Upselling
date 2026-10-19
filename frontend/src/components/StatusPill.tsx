import type { Job } from "../lib/api";

export default function StatusPill({ job }: { job: Job }) {
  if (job.status === "completed") return <span className="pill good">Ready</span>;
  if (job.status === "failed") return <span className="pill bad">Failed</span>;
  if (job.status === "cancelled") return <span className="pill neutral">Stopped</span>;
  return <span className="pill accent">{job.status === "queued" ? "Waiting" : `Analysing ${Math.round(job.progress * 100)}%`}</span>;
}
