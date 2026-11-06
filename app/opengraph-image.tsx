import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

export const alt = `${SITE_NAME}: ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Social preview card, rendered once at build time.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "linear-gradient(135deg, #020617 0%, #1e1b4b 100%)",
          color: "#f8fafc",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: "#6366f1",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 40,
            }}
          >
            ?
          </div>
          <div style={{ fontSize: 40, fontWeight: 700 }}>{SITE_NAME}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1, maxWidth: 1000 }}>
            {SITE_TAGLINE}
          </div>
          <div style={{ fontSize: 30, color: "#c7d2fe" }}>
            Free Socratic tutor · English, Hinglish, Hindi + 16 languages · NISM, CFA, GATE prep
          </div>
        </div>

        <div style={{ display: "flex", gap: 16, fontSize: 26, color: "#e0e7ff" }}>
          {["1. Ask a topic", "2. Answer its questions", "3. Quiz and fix the gaps"].map((step) => (
            <div
              key={step}
              style={{
                display: "flex",
                padding: "10px 22px",
                borderRadius: 999,
                border: "2px solid rgba(165,180,252,0.5)",
              }}
            >
              {step}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
