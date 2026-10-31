import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location("gen_tokens", Path(__file__).resolve().parents[1] / "gen_tokens.py")
gen_tokens = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gen_tokens)


def test_parse_reads_declarations_and_skips_resets_and_comments():
    css = "@theme static {\n  --color-*: initial;\n  /* --color-old: #000; */\n  --color-ink: #1C1C1A;\n  --text-sm: 13px;\n}"
    assert gen_tokens.parse(css) == {"color-ink": "#1C1C1A", "text-sm": "13px"}


def test_generated_python_and_email_tokens_match_the_css():
    assert gen_tokens.main(["--check"]) == 0
