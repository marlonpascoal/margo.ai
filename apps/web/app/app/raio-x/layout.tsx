// P19 to P24 / W10 to W15: the X-ray journey in the owner portal (docs/m1-owner-journey-draft.md). Styles of the
// prototype, tokens only (raio-x.css). Each page checks its own 04 §5 row and the m1.portal flag.
import type { ReactNode } from "react";
import "./raio-x.css";

export default function RaioXLayout({ children }: { children: ReactNode }) {
  return <div className="rx">{children}</div>;
}
