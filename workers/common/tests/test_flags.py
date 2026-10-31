"""A05: workers evaluate flags through public.flag_enabled (fake RPC here; the SQL rule has pgTAP tests)."""

import pytest
from margo_common.flags import FlagOff, flag_enabled, flag_env, require_flag


class FakeRpc:
    def __init__(self, on: set[tuple[str, str | None, str]], result_override=None):
        self.on = on
        self.calls: list[tuple[str, dict]] = []
        self.result_override = result_override

    def __call__(self, fn, params):
        self.calls.append((fn, dict(params)))
        if self.result_override is not None:
            return self.result_override
        return (params["p_key"], params["p_account"], params["p_env"]) in self.on


def test_A05_flag_enabled_calls_the_sql_function_with_key_account_env():
    rpc = FakeRpc({("m2.ifood_api", "acc-1", "production")})
    assert flag_enabled("m2.ifood_api", "acc-1", "production", rpc=rpc) is True
    assert flag_enabled("m2.ifood_api", "acc-2", "production", rpc=rpc) is False
    assert rpc.calls[0] == ("flag_enabled", {"p_key": "m2.ifood_api", "p_account": "acc-1", "p_env": "production"})


def test_A05_system_job_passes_no_account():
    rpc = FakeRpc({("m1.raio_x", None, "sandbox")})
    assert flag_enabled("m1.raio_x", None, "sandbox", rpc=rpc) is True


def test_A05_only_a_literal_true_is_on():
    for result in (None, "true", 1, [True]):
        assert flag_enabled("m1.raio_x", "acc-1", "sandbox", rpc=FakeRpc(set(), result_override=result)) is False


def test_A05_job_refuses_to_run_when_its_flag_is_off():
    rpc = FakeRpc({("m2.contestacao", "acc-1", "sandbox")})
    require_flag("m2.contestacao", "acc-1", "sandbox", rpc=rpc)
    with pytest.raises(FlagOff) as off:
        require_flag("m2.contestacao", "acc-2", "sandbox", rpc=rpc)
    assert (off.value.key, off.value.account_id, off.value.env) == ("m2.contestacao", "acc-2", "sandbox")


def test_A05_rpc_errors_propagate():
    def broken(fn, params):
        raise ConnectionError("database down")

    with pytest.raises(ConnectionError):
        flag_enabled("m1.raio_x", "acc-1", "sandbox", rpc=broken)


def test_A05_env_from_MARGO_FLAG_ENV_default_sandbox():
    assert flag_env({}) == "sandbox"
    assert flag_env({"MARGO_FLAG_ENV": ""}) == "sandbox"
    assert flag_env({"MARGO_FLAG_ENV": "production"}) == "production"
    with pytest.raises(ValueError, match="MARGO_FLAG_ENV"):
        flag_env({"MARGO_FLAG_ENV": "prod"})
