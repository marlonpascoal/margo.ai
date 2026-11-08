// B01 P23 "Baixar PDF": the printed copy is cached per result version; the print page needs worker-render's token.
import { describe, expect, it } from "vitest";
import { PRINT_LAYOUT, pdfFileName, printVersion, printDedupeKey, printTokenValid, requestPrint, tokenHash, type PrintDeps } from "./print";

function fake(printed: { path: string; pages: number } | null) {
  const jobs: unknown[] = [];
  const used = new Set<string>();
  const deps: PrintDeps = {
    printed: async () => printed,
    enqueue: async (j) => {
      jobs.push(j);
      return { jobId: "job-1", deduped: jobs.length > 1 };
    },
    useToken: async (_x, h) => {
      if (used.has(h)) return false;
      used.add(h);
      return h === tokenHash("t".repeat(43));
    },
  };
  return { deps, jobs };
}

describe("B01 P23 Baixar PDF", () => {
  it("B01_P23_pdf_served_from_cache_for_the_same_version", async () => {
    const { deps, jobs } = fake({ path: "raio-x/G-02/x-v1.pdf", pages: 3 });
    expect(await requestPrint(deps, { xrayId: "x", version: "v1", accountId: "a" })).toEqual({ state: "ready", path: "raio-x/G-02/x-v1.pdf", pages: 3 });
    expect(jobs).toHaveLength(0);
  });

  it("B01_P23_pdf_queues_one_print_job_per_version", async () => {
    const { deps, jobs } = fake(null);
    const r = await requestPrint(deps, { xrayId: "x", version: "v2", accountId: "a" });
    expect(r).toEqual({ state: "preparing", jobId: "job-1", deduped: false });
    expect(jobs).toEqual([{ type: "render_xray", payload: { xray_id: "x", mode: "print", version: "v2" }, accountId: "a", dedupeKey: printDedupeKey("x", "v2") }]);
    expect(printDedupeKey("x", "v2")).toBe("render_xray:print:x:v2");
  });

  it("B01_P23_print_page_needs_a_fresh_token_once", async () => {
    const { deps } = fake(null);
    expect(await printTokenValid(deps, "x", undefined)).toBe(false);
    expect(await printTokenValid(deps, "x", "short")).toBe(false);
    expect(await printTokenValid(deps, "x", "t".repeat(43))).toBe(true);
    expect(await printTokenValid(deps, "x", "t".repeat(43))).toBe(false);
  });

  it("B01_P23_pdf_file_name", () => {
    expect(pdfFileName("Burger do Bairro Centro", "2026-11-02")).toBe("raio-x-burger-do-bairro-centro-2026-11-02.pdf");
    expect(pdfFileName("Açaí & Cia", "2026-11-02")).toBe("raio-x-acai-cia-2026-11-02.pdf");
  });
  it("B01_P23_a_new_print_layout_never_serves_an_older_copy", () => {
    expect(printVersion("abc")).toBe(`abc.l${PRINT_LAYOUT}`);
    expect(printVersion("abc")).not.toBe("abc");
  });
});
