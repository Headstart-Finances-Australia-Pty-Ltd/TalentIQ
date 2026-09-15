import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Calendar, Check, Clock, MapPin, Users } from "lucide-react";
import { publicInterviewScheduleApi } from "../lib/api";

export default function PublicInterviewSchedulePage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!token) return;
    publicInterviewScheduleApi.get(token)
      .then((res) => { setData(res); if (res.already_confirmed) setConfirmed(true); })
      .catch((e) => setError(e?.response?.data?.detail || "This scheduling link is invalid or has expired."))
      .finally(() => setLoading(false));
  }, [token]);

  const confirm = async () => {
    if (!token || !selectedSlot) return;
    setConfirming(true);
    try {
      await publicInterviewScheduleApi.confirm(token, selectedSlot);
      setConfirmed(true);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not confirm that time — please try another option.");
    } finally {
      setConfirming(false);
    }
  };

  const wrap = (children: React.ReactNode) => (
    <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 32, maxWidth: 480, width: "100%", boxShadow: "0 10px 40px rgba(0,0,0,.08)" }}>
        {children}
      </div>
    </div>
  );

  if (loading) return wrap(<div style={{ textAlign: "center", color: "#64748b" }}>Loading…</div>);
  if (error && !data) return wrap(<div style={{ textAlign: "center", color: "#ef4444" }}>{error}</div>);
  if (!data) return null;

  if (confirmed) {
    return wrap(
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(16,185,129,.12)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
          <Check size={28} color="#10b981" />
        </div>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 6 }}>Interview Confirmed</div>
        <div style={{ color: "#64748b", fontSize: 14, marginBottom: 4 }}>{data.round_name}</div>
        {data.confirmed_slot && (
          <div style={{ fontWeight: 600, fontSize: 15, marginTop: 12 }}>
            {new Date(data.confirmed_slot).toLocaleString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </div>
        )}
        {data.location_or_link && <div style={{ color: "#64748b", fontSize: 13, marginTop: 10 }}>{data.location_or_link}</div>}
      </div>
    );
  }

  return wrap(
    <div>
      <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>{data.round_name}</div>
      {data.requisition_title && <div style={{ color: "#64748b", fontSize: 13, marginBottom: 16 }}>{data.requisition_title}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20, fontSize: 13, color: "#374151" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Clock size={14} /> {data.duration_minutes} minutes</div>
        {data.location_or_link && <div style={{ display: "flex", alignItems: "center", gap: 8 }}><MapPin size={14} /> {data.location_or_link}</div>}
        {data.interviewers?.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Users size={14} /> {data.interviewers.map((iv: any) => iv.name).join(", ")}
          </div>
        )}
      </div>

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
        <Calendar size={14} /> Pick a time
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
        {(data.proposed_slots || []).map((slot: string) => (
          <label key={slot}
                 style={{
                   display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10,
                   border: `1.5px solid ${selectedSlot === slot ? "#0d9488" : "#e5e7eb"}`,
                   background: selectedSlot === slot ? "rgba(13,148,136,.06)" : "#fff", cursor: "pointer",
                 }}>
            <input type="radio" name="slot" checked={selectedSlot === slot} onChange={() => setSelectedSlot(slot)} />
            <span style={{ fontSize: 14 }}>
              {new Date(slot).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </span>
          </label>
        ))}
      </div>

      {error && <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <button
        onClick={confirm}
        disabled={!selectedSlot || confirming}
        style={{
          width: "100%", padding: "12px", borderRadius: 10, border: "none",
          background: !selectedSlot ? "#e5e7eb" : "#0d9488", color: !selectedSlot ? "#9ca3af" : "#fff",
          fontWeight: 700, fontSize: 14, cursor: !selectedSlot ? "not-allowed" : "pointer",
        }}
      >
        {confirming ? "Confirming…" : "Confirm This Time"}
      </button>
    </div>
  );
}
