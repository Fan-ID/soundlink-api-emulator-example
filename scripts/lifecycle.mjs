import { Soundlink } from "soundlink";
import { createApiEmulator } from "soundlink/api-emulator";

const apiKey = "sk_emulator_test";
const initialBalance = 500;
const dailyBudget = 10;
const durationDays = 7;
const committed = dailyBudget * durationDays;
const mediaSpend = 40;

const createBody = {
  spotifyUrl: "https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh",
  dailyBudget,
  durationDays,
  genre: "Pop",
  strategyType: "maximum_growth",
  autoRenew: false,
};

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

async function unwrap(result, label) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.code} ${result.error.message}`);
  }
  if (result.data == null) {
    throw new Error(`${label}: empty data`);
  }
  return result.data;
}

const emulator = createApiEmulator({
  apiKey,
  initialWalletBalance: initialBalance,
  plan: "enterprise",
});
const server = await emulator.listen({ port: 0 });

try {
  const soundlink = new Soundlink({ apiKey, baseUrl: server.baseUrl });

  const ping = await unwrap(await soundlink.ping(), "ping");
  assertEqual(ping.status, "ok", "ping status");

  const walletBefore = await unwrap(await soundlink.wallet.get(), "wallet");
  assertEqual(walletBefore.balance, initialBalance, "starting balance");
  assertEqual(walletBefore.reserved, 0, "starting reserved");

  const created = await unwrap(
    await soundlink.campaigns.create(createBody, {
      idempotencyKey: "lifecycle-create",
    }),
    "create",
  );
  assertEqual(created.status, "creating", "create status");

  const afterCreate = await unwrap(
    await soundlink.wallet.get(),
    "wallet after create",
  );
  assertEqual(
    afterCreate.balance,
    initialBalance - committed,
    "balance after create",
  );

  emulator.transition(created.campaignId, "activate");
  emulator.transition(created.campaignId, "set_spend", mediaSpend);

  const detail = await unwrap(
    await soundlink.campaigns.get(created.campaignId),
    "campaign",
  );
  assertEqual(detail.status, "active", "campaign status");
  assertEqual(detail.generation, 3, "campaign generation");

  const overview = await unwrap(
    await soundlink.metrics.overview(created.campaignId),
    "overview",
  );
  assertEqual(overview.spend_media, 40, "spend_media");
  assertEqual(overview.fees, 4.44, "fees");
  assertEqual(overview.spend_total, 44.44, "spend_total");

  await unwrap(
    await soundlink.campaigns.stop(created.campaignId, {
      idempotencyKey: "lifecycle-stop",
    }),
    "stop",
  );

  const afterStop = await unwrap(
    await soundlink.wallet.get(),
    "wallet after stop",
  );
  assertEqual(afterStop.balance, 455.56, "balance after partial spend stop");

  const rejected = await unwrap(
    await soundlink.campaigns.create(createBody, {
      idempotencyKey: "lifecycle-reject-create",
    }),
    "create rejected",
  );
  const balanceBeforeReject = (
    await unwrap(await soundlink.wallet.get(), "wallet before reject")
  ).balance;

  emulator.transition(rejected.campaignId, "reject_meta");
  const inactive = await unwrap(
    await soundlink.campaigns.get(rejected.campaignId),
    "rejected campaign",
  );
  assertEqual(inactive.status, "inactive", "reject status");

  const balanceAfterReject = (
    await unwrap(await soundlink.wallet.get(), "wallet after reject")
  ).balance;
  assertEqual(
    balanceAfterReject,
    balanceBeforeReject,
    "reject does not refund",
  );

  await unwrap(
    await soundlink.campaigns.stop(rejected.campaignId, {
      idempotencyKey: "lifecycle-reject-stop",
    }),
    "stop rejected",
  );
  const afterRejectStop = await unwrap(
    await soundlink.wallet.get(),
    "wallet after reject stop",
  );
  assertEqual(afterRejectStop.balance, 455.56, "full refund after reject");

  console.log(
    `passed lifecycle wallet ${initialBalance} → ${afterCreate.balance} → ${afterStop.balance}`,
  );
} finally {
  await server.close();
}

const low = createApiEmulator({
  apiKey,
  initialWalletBalance: 10,
  plan: "enterprise",
});
const lowServer = await low.listen({ port: 0 });

try {
  const lowClient = new Soundlink({ apiKey, baseUrl: lowServer.baseUrl });
  const denied = await lowClient.campaigns.create(createBody, {
    idempotencyKey: "create-1",
  });
  if (!denied.error) {
    throw new Error("402: expected an error");
  }
  assertEqual(denied.error.code, "insufficient_credit", "402 code");
  assertEqual(denied.error.status, 402, "402 status");
  assertEqual(denied.error.details.available, 10, "402 available");
  assertEqual(denied.error.details.required, committed, "402 required");

  low.setWallet(500);
  const toppedUp = await unwrap(
    await lowClient.campaigns.create(createBody, {
      idempotencyKey: "create-2",
    }),
    "create after top up",
  );
  assertEqual(toppedUp.status, "creating", "create after top up");
  console.log("passed insufficient credit retry with a new Idempotency-Key");
} finally {
  await lowServer.close();
}
