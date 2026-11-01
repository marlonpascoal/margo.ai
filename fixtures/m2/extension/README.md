# fixtures/m2/extension: synthetic Partner Portal page (SINTÉTICO)

`portal-SINTETICO.html` is **not** a copy of the iFood Partner Portal. We have no recording of the real
page. It is the smallest page that exports the way web apps commonly do, so the P04 content script can be
tested in a real browser. `apps/web/e2e/ext-export.e2e.ts` serves it at
`https://portal.ifood.com.br/financeiro/...` through Playwright routing. Nothing reaches iFood.

## What Marlon must confirm on the real portal

Everything the extension assumes about the portal sits in one place, `PORTAL_EXPORT` in
`extension/src/config.ts`:

1. **Pages** (`reportPaths`, now `/financeiro`): the path of the reconciliation and sales report pages
   once logged in.
2. **Export button** (`buttonSelectors`, `buttonTexts`, now the text `Exportar`): the button's text, or a
   stable attribute (`data-testid`, `aria-label`). If the export opens a menu or asks for the period
   first, tell the lead: today the extension makes one click.
3. **How the file arrives**: with the DevTools Network tab open, click Export and note one of these:
   - a `blob:` URL (the page builds the file). The extension catches it in the page.
   - a link to a URL on `portal.ifood.com.br`. The extension reads it the way the page would.
   - a URL on **another host** (for example a storage bucket). The extension cannot read it, and the
     owner falls back to picking the file in the popup. A change to `host_permissions` would be needed.
4. **File type**: `.csv` or `.xlsx` (the only two the upload accepts).

Until these are confirmed, the popup keeps the manual fallback: when the button is not found, "Exportar e
enviar" asks the owner to pick the file they exported.
