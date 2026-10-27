import { useState, type Ref } from "react";
import { Plus } from "../icons/Icons";

type Person = { name: string; recordings: number };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/**
 * Who is selling in this recording: the team as a list you can see and pick from, a search box to narrow it
 * down, and a way to add someone new. `value` is the chosen name ("" until one is picked).
 */
export default function PersonPicker({
  people,
  value,
  onChange,
  inputRef,
}: {
  people: Person[];
  value: string;
  onChange: (name: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim();
  const shown = q ? people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())) : people;
  const exact = people.some((p) => p.name.toLowerCase() === q.toLowerCase());
  const canAdd = q.length > 0 && !exact;

  const pick = (name: string) => {
    onChange(name);
    setQuery("");
  };

  return (
    <div className="rec-field">
      <label htmlFor="rec-search">
        Salesperson <em className="rec-req">required</em>
      </label>
      <input
        id="rec-search"
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault(); // Enter picks the first match instead of submitting anything
          if (shown[0]) pick(shown[0].name);
          else if (canAdd) pick(q);
        }}
        placeholder={people.length ? "Search the team, or type a new name" : "Type the salesperson's name"}
        maxLength={80}
        autoComplete="off"
      />
      <div className="rec-people" role="radiogroup" aria-label="Salesperson">
        {shown.map((p) => (
          <label key={p.name} className={`rec-person ${value === p.name ? "on" : ""}`}>
            <input type="radio" name="rec-salesperson" checked={value === p.name} onChange={() => pick(p.name)} />
            <span className="rec-avatar" aria-hidden="true">
              {initials(p.name)}
            </span>
            <span className="rec-pname">{p.name}</span>
            <span className="rec-pcount">
              {p.recordings} recording{p.recordings === 1 ? "" : "s"}
            </span>
          </label>
        ))}
        {canAdd && (
          <label className={`rec-person add ${value === q ? "on" : ""}`}>
            <input type="radio" name="rec-salesperson" checked={value === q} onChange={() => pick(q)} />
            <span className="rec-avatar" aria-hidden="true">
              <Plus size={14} />
            </span>
            <span className="rec-pname">Add &ldquo;{q}&rdquo; as a new salesperson</span>
          </label>
        )}
        {!shown.length && !canAdd && <p className="rec-pempty">No salespeople yet. Type a name above.</p>}
      </div>
      {value && (
        <small className="rec-help">
          Recording for <strong>{value}</strong>
        </small>
      )}
    </div>
  );
}
