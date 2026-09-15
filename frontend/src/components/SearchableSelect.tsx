import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";

export interface SearchableOption {
  value: string;
  label: string;
  sublabel?: string;
}

// A type-to-filter dropdown for option lists that can actually grow long
// (clients, JDs, hiring managers) — a plain <select> works fine for a
// handful of fixed choices (Priority, Employment Type), but scrolling a
// native dropdown to find one of fifty clients by eye is exactly the
// friction this replaces. Kept dependency-free (no combobox library) to
// match everything else in this codebase.
export default function SearchableSelect({
  options, value, onChange, placeholder = "— Select —", allowClear = true,
}: {
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const selected = options.find((o) => o.value === value);
  const filtered = query.trim()
    ? options.filter((o) => (o.label + " " + (o.sublabel || "")).toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button type="button" onClick={() => { setOpen((o) => !o); setQuery(""); }}
        className="tiq-select" style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
        <span style={{ color: selected ? "inherit" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected ? selected.label : placeholder}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {allowClear && selected && (
            <X size={13} style={{ color: "var(--text-muted)" }}
               onClick={(e) => { e.stopPropagation(); onChange(""); }} />
          )}
          <ChevronDown size={13} style={{ color: "var(--text-muted)" }} />
        </span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50,
          background: "#fff", border: "1px solid var(--border)", borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,.12)", maxHeight: 260, display: "flex", flexDirection: "column",
        }}>
          <div style={{ position: "relative", padding: 6, borderBottom: "1px solid var(--border)" }}>
            <Search size={13} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input
              autoFocus className="tiq-input" style={{ paddingLeft: 28, fontSize: 13 }}
              placeholder="Type to search…" value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
            />
          </div>
          <div style={{ overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "10px 12px", fontSize: 12.5, color: "var(--text-muted)" }}>No matches.</div>
            ) : (
              filtered.map((o) => (
                <div key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
                  style={{
                    padding: "8px 12px", fontSize: 13, cursor: "pointer",
                    background: o.value === value ? "rgba(13,148,136,.08)" : "transparent",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(0,0,0,.04)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = o.value === value ? "rgba(13,148,136,.08)" : "transparent")}>
                  <div>{o.label}</div>
                  {o.sublabel && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{o.sublabel}</div>}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
