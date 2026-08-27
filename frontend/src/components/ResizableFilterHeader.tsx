import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * A column header that's both a click-to-filter dropdown (options are
 * whatever values are actually present in the current data — see each
 * page's colOptions()) AND a resizable column (drag the light bar on the
 * right edge). Shared by RequisitionsPage and AcquisitionPage so both
 * tables behave identically instead of drifting into two subtly
 * different implementations.
 *
 * Requires the enclosing <table> to have `table-layout: fixed` — plain
 * `<th>` width hints are otherwise just a suggestion the browser can
 * override based on cell content, which makes a drag handle feel broken
 * (the column snaps back). Fixed layout makes the header's width the
 * actual, authoritative column width.
 */
export function ResizableFilterHeader({
  label, value, options, onChange, width, onWidthChange, align = "left", minWidth = 70, filterable = true,
}: {
  label: string; value?: string; options?: string[]; onChange?: (v: string) => void;
  width: number; onWidthChange: (w: number) => void; align?: "left" | "center"; minWidth?: number; filterable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const resizing = useRef<{ startX: number; startWidth: number } | null>(null);
  const [, forceRender] = useState(0); // re-render while dragging so the live width shows immediately

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const delta = e.clientX - resizing.current.startX;
      onWidthChange(Math.max(minWidth, resizing.current.startWidth + delta));
      forceRender((n) => n + 1);
    };
    const onUp = () => { resizing.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onWidthChange, minWidth]);

  return (
    <th style={{ position: "relative", textAlign: align, width, minWidth: width, maxWidth: width, boxSizing: "border-box" }}>
      {/* Truncation wrapper — overflow:hidden lives HERE, not on the <th>
          itself, so it clips only the label text. Putting it on the <th>
          also clipped the dropdown panel below (positioned relative to
          this same cell), which silently broke every filter click —
          the menu was opening, just invisible. */}
      <div style={{ overflow: "hidden" }}>
        {filterable && onChange ? (
          <button
            onClick={() => setOpen((v) => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 4, justifyContent: align === "center" ? "center" : "flex-start",
              width: "100%", background: "none", border: "none", cursor: "pointer", font: "inherit", fontWeight: "inherit",
              color: "inherit", padding: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{label}</span>
            {value && <span style={{ color: "var(--violet-500)", flexShrink: 0 }}>({value})</span>}
            <ChevronDown size={12} style={{ flexShrink: 0 }} />
          </button>
        ) : (
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>{label}</span>
        )}
      </div>
      {open && filterable && onChange && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => setOpen(false)} />
          <div style={{
            position: "absolute", top: "100%", left: 0, marginTop: 4, background: "#fff", color: "#111827",
            border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,.12)",
            zIndex: 11, minWidth: 160, maxHeight: 280, overflowY: "auto", padding: 4,
          }}>
            <button onClick={() => { onChange(""); setOpen(false); }}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 10px", background: !value ? "var(--slate-100)" : "none", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
              All
            </button>
            {(options || []).map((o) => (
              <button key={o} onClick={() => { onChange(o); setOpen(false); }}
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 10px", background: value === o ? "var(--slate-100)" : "none", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 400, whiteSpace: "nowrap" }}>
                {o}
              </button>
            ))}
          </div>
        </>
      )}
      {/* Resize handle — a thin, light bar on the right edge of the
          header; brightens on hover so it reads as grabbable. */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          resizing.current = { startX: e.clientX, startWidth: width };
        }}
        onDoubleClick={() => onWidthChange(Math.max(minWidth, 140))}
        title="Drag to resize, double-click to reset"
        style={{
          position: "absolute", top: 0, right: 0, bottom: 0, width: 2, cursor: "col-resize",
          background: "var(--slate-300, #cbd5e1)", opacity: 0.5,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = "1"; (e.currentTarget as HTMLDivElement).style.background = "var(--violet-400, #a78bfa)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = "0.5"; (e.currentTarget as HTMLDivElement).style.background = "var(--slate-300, #cbd5e1)"; }}
      />
    </th>
  );
}
