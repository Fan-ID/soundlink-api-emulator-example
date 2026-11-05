import { Soundlink } from "soundlink";
import type {
  ApiResponse,
  CampaignDetail,
  CampaignSummary,
  MetricsOverview,
  WalletData,
} from "soundlink";
import {
  createApiEmulator,
  type ApiEmulator,
  type EmulatorServer,
} from "soundlink/api-emulator";

export const apiKey = "sk_emulator_test";
const emulatorPort = 8787;

const createBody = {
  spotifyUrl: "https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh",
  dailyBudget: 10,
  durationDays: 7,
  genre: "Pop" as const,
  strategyType: "maximum_growth" as const,
  autoRenew: false,
};

export type SeededExample = {
  id: string;
  title: string;
  summary: string;
  steps: string[];
};

const catalog: Array<Omit<SeededExample, "id">> = [
  {
    title: "Creating",
    summary:
      "Create debited the wallet. The campaign is still creating, so overview spend and listeners stay at zero.",
    steps: ["POST /v1/campaigns"],
  },
  {
    title: "Active",
    summary:
      "Harness activate seeded 120 listeners. set_spend set media spend to 40, so fees are 4.44. This campaign's 70 has not been refunded. The wallet figure is the shared balance after every example.",
    steps: ["POST /v1/campaigns", "activate", "set_spend 40"],
  },
  {
    title: "Meta rejected",
    summary:
      "reject_meta moved the campaign to inactive and did not credit the wallet. Refund happens only on stop or end.",
    steps: ["POST /v1/campaigns", "reject_meta"],
  },
  {
    title: "Didn't run",
    summary:
      "reject_meta left the wallet unchanged. stop then refunded this campaign's full 70 because media spend stayed 0. That 70 is already inside the shared wallet total. It is not an extra balance on top of the other examples.",
    steps: [
      "POST /v1/campaigns",
      "reject_meta",
      "POST /v1/campaigns/{id}/stop",
    ],
  },
  {
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
    title: "Ended",
    summary:
      "Harness end closes the cycle the same way as stop. Media spend is 10, so the refund is larger than the stopped example. Nothing here waits for a calendar end date.",
    steps: ["POST /v1/campaigns", "activate", "set_spend 10", "end"],
  },
];

export type Demo = {
  soundlink: Soundlink;
  emulatorUrl: string;
  examples: SeededExample[];
};

declare global {
  var demo: Demo | undefined;
  var demoStart: Promise<Demo> | undefined;
}

function unwrap<T>(result: ApiResponse<T>, label: string): T {
  if (result.error) {
    throw new Error(`${label}: ${result.error.code}`);
  }
  if (result.data == null) {
    throw new Error(`${label}: empty data`);
  }
  return result.data;
}

async function createCampaign(soundlink: Soundlink, idempotencyKey: string) {
  return unwrap(
    await soundlink.campaigns.create(createBody, { idempotencyKey }),
    "create",
  );
}

async function seed(emulator: ApiEmulator, soundlink: Soundlink) {
  const creating = await createCampaign(soundlink, "example-1");
  const active = await createCampaign(soundlink, "example-2");
  emulator.transition(active.campaignId, "activate");
  emulator.transition(active.campaignId, "set_spend", 40);

  const rejected = await createCampaign(soundlink, "example-3");
  emulator.transition(rejected.campaignId, "reject_meta");

  const notRun = await createCampaign(soundlink, "example-4");
  emulator.transition(notRun.campaignId, "reject_meta");
  unwrap(
    await soundlink.campaigns.stop(notRun.campaignId, {
      idempotencyKey: "example-stop-unspent",
    }),
    "stop unspent",
  );

  const stopped = await createCampaign(soundlink, "example-5");
  emulator.transition(stopped.campaignId, "activate");
  emulator.transition(stopped.campaignId, "set_spend", 40);
  unwrap(
    await soundlink.campaigns.stop(stopped.campaignId, {
      idempotencyKey: "example-stop",
    }),
    "stop",
  );

  const ended = await createCampaign(soundlink, "example-6");
  emulator.transition(ended.campaignId, "activate");
  emulator.transition(ended.campaignId, "set_spend", 10);
  emulator.transition(ended.campaignId, "end");

  return [
    { ...catalog[0], id: creating.campaignId },
    { ...catalog[1], id: active.campaignId },
    { ...catalog[2], id: rejected.campaignId },
    { ...catalog[3], id: notRun.campaignId },
    { ...catalog[4], id: stopped.campaignId },
    { ...catalog[5], id: ended.campaignId },
  ];
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function listenError(error: unknown): Error {
  if (errorCode(error) === "EADDRINUSE") {
    return new Error(
      `127.0.0.1:${emulatorPort} is already in use. Stop the other npm run dev or npm start, then reload.`,
    );
  }
  if (error instanceof Error) return error;
  return new Error("The emulator did not start.");
}

async function start(): Promise<Demo> {
  const emulator = createApiEmulator({
    apiKey,
    initialWalletBalance: 1000,
    plan: "enterprise",
  });
  let server: EmulatorServer;
  try {
    server = await emulator.listen({ port: emulatorPort });
  } catch (error) {
    throw listenError(error);
  }
  try {
    const soundlink = new Soundlink({ apiKey, baseUrl: server.baseUrl });
    const examples = await seed(emulator, soundlink);
    return { soundlink, emulatorUrl: server.baseUrl, examples };
  } catch (error) {
    await server.close().catch(() => undefined);
    throw error;
  }
}

export async function readDemo(): Promise<
  { demo: Demo } | { message: string }
> {
  try {
    return { demo: await getDemo() };
  } catch (error) {
    return {
      message:
        error instanceof Error ? error.message : "The emulator did not start.",
    };
  }
}

function getDemo(): Promise<Demo> {
  if (globalThis.demo) return Promise.resolve(globalThis.demo);
  if (!globalThis.demoStart) {
    globalThis.demoStart = start()
      .then((demo) => {
        globalThis.demo = demo;
        return demo;
      })
      .catch((error) => {
        globalThis.demoStart = undefined;
        throw error;
      });
  }
  return globalThis.demoStart;
}

export async function getWallet(soundlink: Soundlink): Promise<WalletData> {
  return unwrap(await soundlink.wallet.get(), "wallet");
}

export async function getCampaignList(
  soundlink: Soundlink,
): Promise<CampaignSummary[]> {
  const list = unwrap(
    await soundlink.campaigns.list({ page: 1, pageSize: 20 }),
    "list",
  );
  return list.items;
}

export async function getCampaign(
  soundlink: Soundlink,
  campaignId: string,
): Promise<CampaignDetail | null> {
  const result = await soundlink.campaigns.get(campaignId);
  if (result.error?.code === "campaign_not_found") return null;
  return unwrap(result, "campaign");
}

export async function getOverview(
  soundlink: Soundlink,
  campaignId: string,
): Promise<MetricsOverview> {
  return unwrap(await soundlink.metrics.overview(campaignId), "overview");
}
