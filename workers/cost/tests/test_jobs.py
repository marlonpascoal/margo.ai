"""compute_contribution job payload (worker-cost)."""

from __future__ import annotations

import pytest
from margo_cost.jobs import ContributionPayload
from pydantic import ValidationError


def test_compute_contribution_payload_needs_one_target() -> None:
    assert ContributionPayload(close_period_id="x").as_of is None
    with pytest.raises(ValidationError):
        ContributionPayload()
    with pytest.raises(ValidationError):
        ContributionPayload(close_period_id="x", account_id="y")
