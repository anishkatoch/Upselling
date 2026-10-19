import { money, nice } from "../../lib/format";
import type { RecCtx } from "./shared";

export default function Calls({ ctx }: { ctx: RecCtx }) {
  const { report: r } = ctx;
  return (
    <div className="card">
      <h2>Model calls</h2>
      <p className="sub small" style={{ marginTop: -6, marginBottom: 14 }}>
        Every AI call, including retries and fallbacks. Estimated spend: <b>{money(r.spent_usd)}</b>
        {r.budget_usd != null && ` of a ${money(r.budget_usd)} budget`}
        {r.unpriced_calls > 0 && ` · ${r.unpriced_calls} call(s) have no confirmed price and are shown as "–", not counted above`}.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Step</th>
              <th>Provider</th>
              <th>Result</th>
              <th className="num">Latency</th>
              <th className="num">Tokens in/out</th>
              <th className="num">Cost</th>
              <th className="num">Fallback</th>
            </tr>
          </thead>
          <tbody>
            {r.calls.map((c, i) => (
              <tr key={i}>
                <td>{nice(c.step)}</td>
                <td className="small">{c.provider}</td>
                <td>
                  {c.ok ? <span className="pill good">ok</span> : <span className="pill bad" title={c.error ?? ""}>failed</span>}
                </td>
                <td className="num">{c.latency_s.toFixed(1)}s</td>
                <td className="num">
                  {c.input_tokens ?? "–"} / {c.output_tokens ?? "–"}
                </td>
                <td className="num">{c.cost_usd != null ? `$${c.cost_usd.toFixed(4)}` : "–"}</td>
                <td className="num">{c.fallback_index ? `#${c.fallback_index}` : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.calls.length === 0 && <p className="sub">No model calls recorded.</p>}
    </div>
  );
}
