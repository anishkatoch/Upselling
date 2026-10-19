import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { AlertTriangle, Mic, UploadCloud } from "../icons/Icons";

export default function Upload() {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [more, setMore] = useState(false);
  const [industry, setIndustry] = useState("");
  const [person, setPerson] = useState("");
  const [sent, setSent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = (f?: File | null) => {
    if (f) {
      setFile(f);
      setError(null);
    }
  };

  async function start() {
    if (!file) return;
    setSent(0);
    setError(null);
    try {
      const job = await api.upload(file, { industry: industry.trim(), salesperson: person.trim() }, setSent);
      navigate(`/recordings/${job.job_id}`);
    } catch (e) {
      setSent(null);
      setError(e instanceof Error ? e.message : "Upload failed.");
    }
  }

  if (!file) {
    return (
      <div
        className={`drop ${over ? "over" : ""}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          pick(e.dataTransfer.files[0]);
        }}
      >
        <div className="icon-wrap">
          <UploadCloud size={26} />
        </div>
        <h2>Drop a recording here</h2>
        <p className="sub">or click to choose a file. Audio or video, any length.</p>
        <input ref={input} type="file" accept="audio/*,video/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
        {error && (
          <p className="error" style={{ marginTop: 16, justifyContent: "center" }}>
            <AlertTriangle size={16} /> {error}
          </p>
        )}
      </div>
    );
  }

  const busy = sent !== null;
  return (
    <div className="card stack">
      <div className="row">
        <div className="item-icon">
          <Mic size={17} />
        </div>
        <div className="grow">
          <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</div>
          <div className="sub small">{(file.size / 1048576).toFixed(1)} MB</div>
        </div>
        {!busy && (
          <button className="link" onClick={() => setFile(null)}>
            Change
          </button>
        )}
      </div>

      {!busy && (
        <>
          {more ? (
            <div className="fields">
              <label className="f">
                Salesperson&apos;s name (optional)
                <input value={person} onChange={(e) => setPerson(e.target.value)} placeholder="e.g. Priya" />
              </label>
              <label className="f">
                Type of business (optional)
                <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. electronics store" />
              </label>
            </div>
          ) : (
            <button className="link" style={{ textAlign: "left" }} onClick={() => setMore(true)}>
              + Add details (optional)
            </button>
          )}
          {error && (
            <p className="error">
              <AlertTriangle size={16} /> {error}
            </p>
          )}
          <div>
            <button className="btn big" onClick={start}>
              Analyse this recording
            </button>
          </div>
        </>
      )}

      {busy && (
        <div>
          <div className="bar">
            <i style={{ width: `${Math.round((sent ?? 0) * 100)}%` }} />
          </div>
          <p className="sub small" style={{ marginTop: 8 }}>
            {sent! < 1 ? `Uploading… ${Math.round(sent! * 100)}%` : "Starting the analysis…"}
          </p>
        </div>
      )}
    </div>
  );
}
