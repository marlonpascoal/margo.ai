// P23 (phone) / W14 (computer): the newest calculated X-ray of a monitoring (ResultView.tsx).
import ResultPageServer from "../_components/ResultPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Raio-X de preço · MargoAI" };

export default async function ResultPage({ params }: { params: Promise<{ monitor: string }> }) {
  return <ResultPageServer monitorId={(await params).monitor} />;
}
