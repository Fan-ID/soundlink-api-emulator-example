import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaign, getOverview, readDemo } from "@/lib/emulator";

export const dynamic = "force-dynamic";

function formatValue(value: unknown): string {
  if (value == null) return "null";
  return String(value);
}

function fields(record: object) {
  return Object.entries(record).flatMap(([key, value]) => [
    <dt key={`${key}-label`}>{key}</dt>,
    <dd key={`${key}-value`}>{formatValue(value)}</dd>,
  ]);
}

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await readDemo();
  if (!("demo" in result)) return null;
  const { soundlink, examples } = result.demo;
  const campaign = await getCampaign(soundlink, id);
  if (!campaign) notFound();

  const overview = await getOverview(soundlink, id);
  const example = examples.find((item) => item.id === id);

  return (
    <main>
      <p>
        <Link href="/">Examples</Link>
      </p>
      <h1>{example ? example.title : campaign.campaignId}</h1>
      {example ? <p className="lead">{example.summary}</p> : null}
      {example ? (
        <>
          <h2>Steps</h2>
          <ol>
            {example.steps.map((step) => (
              <li key={step}>
                <code>{step}</code>
              </li>
            ))}
          </ol>
        </>
      ) : null}
      <div className="figures">
        <div>
          <span>Listeners</span>
          <strong>{overview.listeners}</strong>
        </div>
        <div>
          <span>Media spend</span>
          <strong>{overview.spend_media}</strong>
        </div>
        <div>
          <span>Fees</span>
          <strong>{overview.fees}</strong>
        </div>
        <div>
          <span>Total spend</span>
          <strong>{overview.spend_total}</strong>
        </div>
      </div>
      <h2>GET /v1/campaigns/{"{id}"}</h2>
      <dl>{fields(campaign)}</dl>
      <h2>GET /v1/campaigns/{"{id}"}/metrics/overview</h2>
      <dl>{fields(overview)}</dl>
      <h2>Payloads</h2>
      <pre>{JSON.stringify({ campaign, overview }, null, 2)}</pre>
    </main>
  );
}
