// P23 / W14 for a past run of the monitoring ("Outro raio-X"); a run of another monitoring is 404.
import ResultPageServer from "../../_components/ResultPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Raio-X de preço · MargoAI" };

export default async function PastResultPage({ params }: { params: Promise<{ monitor: string; xray: string }> }) {
  const { monitor, xray } = await params;
  return <ResultPageServer monitorId={monitor} xrayId={xray} />;
}
