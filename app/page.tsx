import Link from "next/link";
import { getCampaignList, readDemo } from "@/lib/emulator";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const result = await readDemo();
  if (!("demo" in result)) return null;
  const { soundlink, examples, emulatorUrl } = result.demo;
  const items = await getCampaignList(soundlink);
  const byId = new Map(items.map((item) => [item.campaignId, item]));

  return (
    <main>
      <h1>Campaign examples</h1>
      <p className="lead">
        Seeded once at startup against {emulatorUrl}, plan enterprise (fee
        0.1), starting balance 1000. Restart <code>npm run dev</code> to seed
        again. The balance above is shared by every card.
      </p>
      <div className="cards">
        {examples.map((example) => {
          const item = byId.get(example.id);
          if (!item) {
            throw new Error(`seeded campaign missing from list: ${example.id}`);
          }
          return (
            <Link className="card" href={`/campaigns/${example.id}`} key={example.id}>
              <div className="row">
                <strong>{example.title}</strong>
                <span className={`status status-${item.status}`}>{item.status}</span>
              </div>
              <p>{example.summary}</p>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
