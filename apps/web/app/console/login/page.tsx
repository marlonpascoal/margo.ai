// C00 Login do console (design/C00-Login.dc.html). Invited staff e-mails only; the API answers every
// address the same way (no account enumeration).
import { redirect } from "next/navigation";
import { consoleStaff } from "@/lib/console/staff";
import LoginForm from "./LoginForm";

export const metadata = { title: "Entrar no console · MargoAI" };

export default async function ConsoleLoginPage() {
  if (await consoleStaff()) redirect("/console");
  return (
    <div className="box-border flex min-h-screen items-center justify-center bg-sunken p-4 text-ink md:p-8">
      <div className="box-border flex w-full max-w-card flex-col gap-4 rounded-2xl border border-border bg-surface p-6 md:p-8">
        <div className="flex flex-col gap-1">
          <b className="text-xl">MargoAI</b>
          <span className="font-mono text-xs text-ink-muted">console dos fundadores · só convidados</span>
        </div>
        <h1 className="m-0 text-2xl font-bold">Entrar no console</h1>
        <LoginForm />
        <div className="border-t border-border-subtle pt-3 text-sm leading-[1.55] text-ink-muted">
          Só e-mails convidados em Configurações entram. O papel (Fundador ou Operação) vem do convite. A sessão dura 12 horas. Toda
          ação no console fica registrada com quem fez.
        </div>
      </div>
    </div>
  );
}
