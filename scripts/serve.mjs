import { createServer } from "node:http";
import { Soundlink } from "soundlink";
import { createApiEmulator } from "soundlink/api-emulator";

const apiKey = "sk_emulator_test";
const emulatorPort = 8787;
const viewerPort = Number(process.env.PORT) || 8788;

const createBody = {
  spotifyUrl: "https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh",
  dailyBudget: 10,
  durationDays: 7,
  genre: "Pop",
  strategyType: "maximum_growth",
  autoRenew: false,
};

const examples = [
  {
    id: "",
    title: "Creating",
    summary:
      "Create debited the wallet. The campaign is still creating, so overview spend and listeners stay at zero.",
    steps: ["POST /v1/campaigns"],
  },
  {
    id: "",
    title: "Active",
    summary:
      "Harness activate seeded 120 listeners. set_spend set media spend to 40, so fees are 4.44. This campaign's 70 has not been refunded. The wallet figure is the shared balance after every example.",
    steps: ["POST /v1/campaigns", "activate", "set_spend 40"],
  },
  {
    id: "",
    title: "Meta rejected",
    summary:
      "reject_meta moved the campaign to inactive and did not credit the wallet. Refund happens only on stop or end.",
    steps: ["POST /v1/campaigns", "reject_meta"],
  },
  {
    id: "",
    title: "Stopped",
    summary:
      "Same spend as Active, then public stop. Refund is 70 − 40 / 0.9 = 25.56, credited once.",
    steps: [
      "POST /v1/campaigns",
      "activate",
      "set_spend 40",
      "POST /v1/campaigns/{id}/stop",
    ],
  },
  {
    id: "",
    title: "Ended",
    summary:
      "Harness end closes the cycle the same way as stop. Media spend is 10, so the refund is larger than the stopped example.",
    steps: ["POST /v1/campaigns", "activate", "set_spend 10", "end"],
  },
];

function assertOk(result, label) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.code}`);
  }
  if (result.data == null) {
    throw new Error(`${label}: empty data`);
  }
  return result.data;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatValue(value) {
  if (value == null) return "null";
  return String(value);
}

function definitionList(record) {
  const rows = Object.entries(record)
    .map(
      ([key, value]) =>
        `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(formatValue(value))}</dd>`,
    )
    .join("");
  return `<dl>${rows}</dl>`;
}

function layout(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font: 16px/1.5 ui-sans-serif, system-ui, sans-serif; background: #f6f5f2; color: #1c1917; }
    main { max-width: 52rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
    a { color: #9a3412; }
    h1 { font-size: 1.75rem; line-height: 1.2; margin: 0 0 0.5rem; }
    h2 { font-size: 1.1rem; margin: 2rem 0 0.5rem; }
    p, li { max-width: 42rem; }
    table { width: 100%; border-collapse: collapse; background: #fff; }
    th, td { text-align: left; padding: 0.6rem 0.75rem; border-bottom: 1px solid #e7e5e4; vertical-align: top; }
    th { font-size: 0.75rem; letter-spacing: 0.04em; text-transform: uppercase; color: #57534e; }
    dl { display: grid; grid-template-columns: 12rem 1fr; gap: 0.35rem 1rem; margin: 0; background: #fff; padding: 1rem; }
    dt { color: #57534e; }
    dd { margin: 0; font-variant-numeric: tabular-nums; }
    pre { overflow: auto; background: #1c1917; color: #fafaf9; padding: 1rem; font-size: 0.85rem; }
    .note { color: #44403c; }
    @media (max-width: 640px) {
      dl { grid-template-columns: 1fr; }
      dd { margin-bottom: 0.75rem; }
    }
  </style>
</head>
<body>
  <main>
    ${body}
  </main>
</body>
</html>`;
}

const emulator = createApiEmulator({
  apiKey,
  initialWalletBalance: 1000,
  plan: "enterprise",
});
const emulatorServer = await emulator.listen({ port: emulatorPort });
const soundlink = new Soundlink({ apiKey, baseUrl: emulatorServer.baseUrl });

let idempotency = 0;
async function createCampaign() {
  idempotency += 1;
  return assertOk(
    await soundlink.campaigns.create(createBody, {
      idempotencyKey: `example-${idempotency}`,
    }),
    "create",
  );
}

const creating = await createCampaign();
examples[0].id = creating.campaignId;

const active = await createCampaign();
emulator.transition(active.campaignId, "activate");
emulator.transition(active.campaignId, "set_spend", 40);
examples[1].id = active.campaignId;

const rejected = await createCampaign();
emulator.transition(rejected.campaignId, "reject_meta");
examples[2].id = rejected.campaignId;

const stopped = await createCampaign();
emulator.transition(stopped.campaignId, "activate");
emulator.transition(stopped.campaignId, "set_spend", 40);
assertOk(
  await soundlink.campaigns.stop(stopped.campaignId, {
    idempotencyKey: "example-stop",
  }),
  "stop",
);
examples[3].id = stopped.campaignId;

const ended = await createCampaign();
emulator.transition(ended.campaignId, "activate");
emulator.transition(ended.campaignId, "set_spend", 10);
emulator.transition(ended.campaignId, "end");
examples[4].id = ended.campaignId;

function findExample(campaignId) {
  return examples.find((example) => example.id === campaignId);
}

async function renderIndex() {
  const list = assertOk(
    await soundlink.campaigns.list({ page: 1, pageSize: 20 }),
    "list",
  );
  const byId = new Map(list.items.map((item) => [item.campaignId, item]));
  const wallet = assertOk(await soundlink.wallet.get(), "wallet");
  const rows = examples
    .map((example) => {
      const item = byId.get(example.id);
      return `<tr>
        <td><a href="/campaigns/${escapeHtml(example.id)}">${escapeHtml(example.title)}</a></td>
        <td>${escapeHtml(item.status)}</td>
        <td>${escapeHtml(formatValue(item.totalBudget))}</td>
        <td>${escapeHtml(example.summary)}</td>
      </tr>`;
    })
    .join("");

  return layout(
    "Emulator examples",
    `<h1>Campaign examples</h1>
    <p class="note">Seeded once at startup against <code>${escapeHtml(emulatorServer.baseUrl)}</code> with plan <code>enterprise</code> (fee 0.1) and a starting balance of 1000. Restart <code>npm start</code> to seed again.</p>
    <p>Wallet now: balance ${escapeHtml(wallet.balance)}, available ${escapeHtml(wallet.available)}, reserved ${escapeHtml(wallet.reserved)}.</p>
    <table>
      <thead><tr><th>Example</th><th>Status</th><th>Total budget</th><th>What it shows</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`,
  );
}

async function renderDetail(campaignId) {
  const example = findExample(campaignId);
  const campaignResult = await soundlink.campaigns.get(campaignId);
  if (campaignResult.error?.code === "campaign_not_found") {
    return {
      status: 404,
      html: layout(
        "Not found",
        '<h1>Campaign not found</h1><p><a href="/">Back</a></p>',
      ),
    };
  }
  const campaign = assertOk(campaignResult, "campaign");
  const overview = assertOk(
    await soundlink.metrics.overview(campaignId),
    "overview",
  );
  const wallet = assertOk(await soundlink.wallet.get(), "wallet");
  const title = example ? example.title : campaignId;
  const steps = example
    ? `<h2>Steps</h2><ol>${example.steps
        .map((step) => `<li><code>${escapeHtml(step)}</code></li>`)
        .join("")}</ol>`
    : "";

  return {
    status: 200,
    html: layout(
      title,
      `<p><a href="/">Examples</a></p>
      <h1>${escapeHtml(title)}</h1>
      ${example ? `<p>${escapeHtml(example.summary)}</p>` : ""}
      ${steps}
      <h2>GET /v1/campaigns/{id}</h2>
      ${definitionList(campaign)}
      <h2>GET /v1/campaigns/{id}/metrics/overview</h2>
      ${definitionList(overview)}
      <h2>GET /v1/wallet</h2>
      <p class="note">Shared by every campaign in this process. <code>reserved</code> stays 0 because create settles immediately.</p>
      ${definitionList(wallet)}
      <h2>Payloads</h2>
      <pre>${escapeHtml(JSON.stringify({ campaign, overview, wallet }, null, 2))}</pre>`,
    ),
  };
}

const viewer = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  try {
    if (request.method === "GET" && url.pathname === "/") {
      const html = await renderIndex();
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    const detail = /^\/campaigns\/([^/]+)$/.exec(url.pathname);
    if (request.method === "GET" && detail) {
      const page = await renderDetail(decodeURIComponent(detail[1]));
      response.writeHead(page.status, {
        "content-type": "text/html; charset=utf-8",
      });
      response.end(page.html);
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  } catch (error) {
    const message = error instanceof Error ? error.message : "render failed";
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(message);
  }
});

viewer.listen(viewerPort, "127.0.0.1", () => {
  console.log(`examples  http://127.0.0.1:${viewerPort}`);
  console.log(`emulator  ${emulatorServer.baseUrl}`);
});
