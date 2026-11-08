// The printed P23 (worker-render, Playwright): no portal shell, the result page's own styles.
import type { ReactNode } from "react";
import "../../app/raio-x/raio-x.css";

export default function PrintLayout({ children }: { children: ReactNode }) {
  return <div className="rx bg-surface">{children}</div>;
}
