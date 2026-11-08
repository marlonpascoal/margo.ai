"use client";
// A short confirmation after an action (prototype toast), announced to screen readers.
import { useEffect } from "react";

export function Toast({ text, onDone }: { text: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [text, onDone]);
  return text ? (
    <div className="toast" role="status">
      {text}
    </div>
  ) : null;
}
