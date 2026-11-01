// P04, runs in the Partner Portal page's own world (manifest "world": "MAIN"), only on that host. Does nothing
// until content.ts arms it for one Export click (attribute on <html>). While armed, each Blob the portal turns
// into an object URL, and each download link it clicks without attaching it to the page, is posted to
// content.ts in the same tab. Nothing leaves the page from here.
import { ARMED_ATTR, HOOK_TAG } from "./portal";

const armed = () => document.documentElement?.getAttribute(ARMED_ATTR) === "armed";
const post = (msg: Record<string, unknown>) => window.postMessage({ tag: HOOK_TAG, ...msg }, location.origin);

const createObjectURL = URL.createObjectURL;
URL.createObjectURL = function (obj: Blob | MediaSource): string {
  const url = createObjectURL.call(URL, obj);
  if (armed() && obj instanceof Blob) post({ kind: "blob", url, blob: obj });
  return url;
};

const click = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement): void {
  if (armed() && this.href) post({ kind: "link", url: this.href, name: this.hasAttribute("download") ? this.download : null });
  return click.call(this);
};
