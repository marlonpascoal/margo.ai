# fixtures/m1: extraction examples (M1, D47b)

X-rays get their data from an external extractor through `/api/extract/*` (`docs/extract-api.md`).

`extract/` holds synthetic request bodies, labeled SINTÉTICO, used by the tests and quoted by the contract:
a discovery, a capture of the target, a capture of a neighbor and a newer capture of it where one item left.
They imitate no recorded page: the shape is the contract's, every store, address and price is invented.

`uv run collector record` still exists for recording public pages under the D47 limits (one request every
3 s, stops on any block), but nothing in the X-ray pipeline reads those recordings any more.
