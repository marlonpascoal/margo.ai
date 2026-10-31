"""Design tokens for PDFs, generated from apps/web/app/tokens.css by scripts/gen_tokens.py.

Do not edit by hand: change the CSS file and run the script."""

TOKENS: dict[str, str] = {
    "color-bg": "#F6F4EF",
    "color-sunken": "#EFECE5",
    "color-surface": "#FFFFFF",
    "color-muted-bg": "#E5E3DE",
    "color-ink": "#1C1C1A",
    "color-ink-2": "#3F3D38",
    "color-ink-muted": "#5D5A52",
    "color-ink-faint": "#8A8378",
    "color-ink-inverse": "#FFFFFF",
    "color-border": "#D6D2C4",
    "color-border-subtle": "#ECE8DF",
    "color-border-strong": "#BDB7A9",
    "color-ok": "#1F7A62",
    "color-ok-strong": "#2A8C72",
    "color-ok-bg": "#E3F2EC",
    "color-ok-border": "#A9D3C4",
    "color-warn": "#8A5A00",
    "color-warn-bg": "#FFF4E0",
    "color-warn-border": "#E3C48A",
    "color-danger": "#B4443A",
    "color-danger-bg": "#FBEAE7",
    "color-danger-border": "#E8B9B1",
    "color-link": "#1351B4",
    "font-sans": '"Public Sans Variable", "Public Sans", ui-sans-serif, system-ui, sans-serif',
    "font-mono": '"IBM Plex Mono", ui-monospace, monospace',
    "text-2xs": "11px",
    "text-xs": "12px",
    "text-sm": "13px",
    "text-md": "14px",
    "text-base": "15px",
    "text-lg": "18px",
    "text-xl": "20px",
    "text-2xl": "24px",
    "text-3xl": "28px",
    "text-4xl": "30px",
    "spacing": "4px",
    "radius-xs": "4px",
    "radius-sm": "6px",
    "radius-md": "8px",
    "radius-lg": "10px",
    "radius-xl": "12px",
    "radius-2xl": "16px",
    "radius-full": "999px",
    "container-sidebar": "232px",
    "container-card": "440px",
}


def token(name: str) -> str:
    """Value of `--name`, e.g. token("color-ink")."""
    return TOKENS[name]
