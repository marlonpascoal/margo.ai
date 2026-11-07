import next from "eslint-config-next";

// D63, 02 §5: portal pages read through Member.db, so RLS applies. An exception is an inline disable with its reason.
const portalReads = {
  files: ["app/app/**/page.tsx", "app/app/layout.tsx", "app/app/**/route.ts", "app/entrar/conta/page.tsx", "lib/portal/*.ts"],
  ignores: ["**/*.test.ts"],
  rules: {
    "no-restricted-imports": ["error", { paths: [{ name: "@/lib/supabase/admin", importNames: ["adminClient"], message: "Portal reads use Member.db (RLS applies); see lib/portal/admin-reads.ts for the exceptions." }] }],
  },
};

const config = [...next, portalReads, { ignores: [".next/**", "next-env.d.ts"] }];

export default config;
