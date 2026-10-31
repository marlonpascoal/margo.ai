import { describe, expect, it } from "vitest";
import { pickAccount, type MembershipChoice } from "./session";

const a: MembershipChoice = { accountId: "a", accountName: "Grupo A", role: "dono" };
const b: MembershipChoice = { accountId: "b", accountName: "Grupo B", role: "gerente" };

describe("P15 account to open after login", () => {
  it("P15_one_membership_opens_directly", () => {
    expect(pickAccount([a], undefined)).toBe("a");
  });

  it("P15_several_memberships_ask_which_to_open", () => {
    expect(pickAccount([a, b], undefined)).toBe("choose");
    expect(pickAccount([a, b], "b")).toBe("b");
  });

  it("P15_a_cookie_for_an_account_the_person_left_is_ignored", () => {
    expect(pickAccount([a, b], "zzz")).toBe("choose");
    expect(pickAccount([a], "zzz")).toBe("a");
  });

  it("P15_no_membership_means_no_portal", () => {
    expect(pickAccount([], "a")).toBeNull();
  });
});
