import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

// Stripe redirects the POPUP window (opened by PricingPage.tsx) here on
// success/cancel — never the user's main tab. This page's only job is to
// tell the opener what happened and close itself; if for some reason
// it's not actually running inside a popup (opener missing — e.g. the
// user reloaded this URL directly), it falls back to just showing the
// result so it's never a dead end.
export default function CheckoutResultPage() {
  const [params] = useSearchParams();
  const status = params.get("status") === "success" ? "success" : "cancelled";
  const [hasOpener, setHasOpener] = useState(true);

  useEffect(() => {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: "stripe-checkout-result", status }, window.location.origin);
      const t = setTimeout(() => window.close(), 900);
      return () => clearTimeout(t);
    } else {
      setHasOpener(false);
    }
  }, [status]);

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'Inter',system-ui,sans-serif", background: "#ffffff", color: "#0f172a", textAlign: "center", padding: 24,
    }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>{status === "success" ? "✅" : "↩️"}</div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
        {status === "success" ? "Payment successful" : "Checkout cancelled"}
      </div>
      <div style={{ fontSize: 13.5, color: "#64748b" }}>
        {hasOpener ? "This window will close automatically…" : (
          status === "success"
            ? "Your plan is now active — you can close this tab and return to TalentIQ."
            : "No charge was made — you can close this tab and return to TalentIQ."
        )}
      </div>
    </div>
  );
}
