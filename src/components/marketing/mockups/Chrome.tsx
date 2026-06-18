import type { ReactNode } from "react";

export function Chrome({ children }: { children: ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={{
        background: "#FBF6EF",
        border: "1px solid rgba(58,32,18,0.12)",
        boxShadow: "0 30px 60px -20px rgba(58,32,18,0.35), 0 8px 24px -8px rgba(58,32,18,0.18)",
      }}
    >
      {children}
    </div>
  );
}

export default Chrome;
