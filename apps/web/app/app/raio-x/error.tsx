"use client";
// P19 to P24 when a read fails: the prototype's "erro ao carregar" state. Monitorings keep running on the server.
export default function RaioXError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="rx-main">
      <div className="banner badb" role="alert">
        <span>Não conseguimos carregar agora. Seus acompanhamentos continuam rodando.</span>
        <button type="button" className="btn sm" onClick={reset}>
          Tentar de novo
        </button>
      </div>
    </main>
  );
}
