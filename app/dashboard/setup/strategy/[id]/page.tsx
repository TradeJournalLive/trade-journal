import ClientDashboard from "../../../ClientDashboard";

export default function StrategyEditPage({
  params
}: {
  params: { id: string };
}) {
  return <ClientDashboard view="setup-edit" editStrategyId={params.id} />;
}
