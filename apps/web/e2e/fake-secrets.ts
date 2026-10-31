/**
 * Fake values the e2e dev server gets for two secrets, so C14 shows them as set and the tests can
 * prove the values never reach a response (A06). "dummy" keeps secret_scan from flagging this file.
 */
export const E2E_FAKE_SECRETS = {
  IFOOD_CLIENT_ID: "dummy-e2e-ifood-client-9d41",
  IFOOD_CLIENT_SECRET: "dummy-e2e-ifood-secret-7f3a",
};
