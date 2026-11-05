# Soundlink API emulator example

A local stand-in for the Soundlink Public API campaign lifecycle. It uses the published [`soundlink`](https://www.npmjs.com/package/soundlink) client against `soundlink/api-emulator` on your machine. No Soundlink account and no Meta spend.

This is not the OAuth reference app. Sign-in, PKCE, and client credentials stay in [soundlink-oauth-example](https://github.com/Fan-ID/soundlink-oauth-example). The emulator accepts `Authorization: Bearer sk_…` only. It does not implement `/oauth`.

The contract notes for the emulator live with the SDK: `node_modules/soundlink/docs/api-emulator.md` after install.

## Run

Requires Node 18 or newer.

```bash
npm install
npm run check
npm start
```

`check` binds `127.0.0.1` on a random port, runs the assertions below, and exits.

`start` keeps two listeners:

| Process  | URL                   | Role                                                |
| -------- | --------------------- | --------------------------------------------------- |
| Viewer   | http://127.0.0.1:8788 | List and campaign detail, rendered on the server    |
| Emulator | http://127.0.0.1:8787 | Public API subset plus `/__emulator` harness routes |

Set `PORT` to move the viewer. The emulator port stays `8787` so the curl examples below keep working. Restart `npm start` to seed the campaigns again. State is memory only.

The API key in this repo is `sk_emulator_test`. The viewer never sends it to the browser. Curl and the SDK send it as `Authorization: Bearer sk_emulator_test`.

## What the viewer seeds

Plan preset `enterprise` (fee `0.1`). Starting balance `1000`. Every campaign is `dailyBudget` 10 for 7 days, so create debits **70**.

Open http://127.0.0.1:8788 and follow each row into the detail page. Detail shows three reads:

- `GET /v1/campaigns/{id}` — includes `strategyType`, `generation` (`3`), and `autoRenew`. The list summary omits `strategyType`.
- `GET /v1/campaigns/{id}/metrics/overview`
- `GET /v1/wallet` — one wallet for the whole process. `reserved` stays `0` because create settles immediately (`available === balance`).

| Example       | Status     | How it was produced                                        | What to look at                                                                  |
| ------------- | ---------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Creating      | `creating` | `POST /v1/campaigns` only                                  | Spend and listeners are 0. The 70 is already gone from the wallet.               |
| Active        | `active`   | `activate`, then `set_spend` 40                            | Seeded audience (120 listeners) plus fees on the 40. Wallet is not credited yet. |
| Meta rejected | `inactive` | `reject_meta`                                              | Status changed. Wallet did not.                                                  |
| Stopped       | `stopped`  | `activate`, `set_spend` 40, `POST /v1/campaigns/{id}/stop` | Refund of unspent gross, once.                                                   |
| Ended         | `ended`    | `activate`, `set_spend` 10, harness `end`                  | Same refund formula as stop, with less spend.                                    |

`activate` and `set_spend` are harness calls. They are not Public API routes. From another process on the same machine:

```bash
curl -s -X POST "http://127.0.0.1:8787/__emulator/campaigns/CAMPAIGN_ID/transition" \
  -H "Content-Type: application/json" \
  -d '{"action":"activate"}'
```

`set_spend` sends `{ "action": "set_spend", "mediaSpendUsd": 40 }`. Spend must be between 0 and the committed 70, and only while the campaign is `creating`, `active`, or `inactive`.

Public reads while `npm start` is running:

```bash
curl -s http://127.0.0.1:8787/v1/campaigns \
  -H "Authorization: Bearer sk_emulator_test"

curl -s http://127.0.0.1:8787/v1/campaigns/CAMPAIGN_ID \
  -H "Authorization: Bearer sk_emulator_test"

curl -s http://127.0.0.1:8787/v1/campaigns/CAMPAIGN_ID/metrics/overview \
  -H "Authorization: Bearer sk_emulator_test"

curl -s http://127.0.0.1:8787/v1/wallet \
  -H "Authorization: Bearer sk_emulator_test"
```

## Wallet math

Committed debit:

```text
dailyBudget × durationDays = 10 × 7 = 70
```

With a fee rate, media spend grosses up before the refund:

```text
grossSpend = mediaSpend / (1 − feeRate)
refund     = max(0, committed − grossSpend)
```

`enterprise` uses fee `0.1`. For media spend 40:

```text
grossSpend = 40 / 0.9 = 44.44
fees       = 44.44 − 40 = 4.44
refund     = 70 − 44.44 = 25.56
```

`npm run check` starts at balance 500, creates once, spends 40, stops, and expects the wallet at **455.56** (`500 − 70 + 25.56`). Overview on that campaign is `spend_media` 40, `fees` 4.44, `spend_total` 44.44.

A second campaign in `check` is rejected with no spend. The balance does not move on `reject_meta`. `stop` then refunds the full 70.

Omitting `plan` and `feeRate` makes the fee `0`, so the refund is `committed − mediaSpend`. Pass `plan` or `feeRate` when the test needs a rate. Presets are local test values, not the public price list.

| Plan                           | Fee    |
| ------------------------------ | ------ |
| _(omit)_                       | `0`    |
| `free`, `artist_pro`, `studio` | `0.2`  |
| `label_power`                  | `0.15` |
| `enterprise`                   | `0.1`  |

## Insufficient credit

`check` also covers a `402`. Balance 10 cannot pay 70:

```text
402 insufficient_credit
details.available = 10
details.required  = 70
```

`setWallet(500)` tops up without deleting campaigns. The retry uses a **new** `Idempotency-Key` (`create-1`, then `create-2`). This emulator does not store the key on create `402`, so the same key would also succeed after the top-up. Do not rely on that. The public API can replay a recorded `402`, and the documented retry is a new key.

## Client wiring

```js
import { Soundlink } from "soundlink";
import { createApiEmulator } from "soundlink/api-emulator";

const apiKey = "sk_emulator_test";
const emulator = createApiEmulator({
  apiKey,
  initialWalletBalance: 500,
  plan: "enterprise",
});
const server = await emulator.listen({ port: 8787 });
const soundlink = new Soundlink({ apiKey, baseUrl: server.baseUrl });

const { data, error } = await soundlink.campaigns.create(
  {
    spotifyUrl: "https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh",
    dailyBudget: 10,
    durationDays: 7,
    genre: "Pop",
    strategyType: "maximum_growth",
    autoRenew: false,
  },
  { idempotencyKey: "demo-1" },
);
```

The SDK adds `/v1` to `baseUrl`. Pass `http://127.0.0.1:8787`, not a URL that already ends in `/v1`.

Create returns `{ campaignId, status: "creating", autoRenew }`. `generation` is on the later GET, not on the 201.

Harness calls that do not need HTTP, when this process owns the emulator:

```js
emulator.transition(data.campaignId, "activate");
emulator.transition(data.campaignId, "set_spend", 40);
await soundlink.campaigns.stop(data.campaignId, { idempotencyKey: "stop-1" });
```

`activate` seeds overview listeners at 120, streams, followers, and click counts. It does not set spend. Only `set_spend` raises `spend_media`.

## Routes this example uses

| Call                                          | Where                                                               |
| --------------------------------------------- | ------------------------------------------------------------------- |
| `GET /v1/ping`                                | `check`                                                             |
| `GET /v1/wallet`                              | `check` and the viewer                                              |
| `GET /v1/campaigns`                           | viewer list                                                         |
| `POST /v1/campaigns`                          | `check` and the seed                                                |
| `GET /v1/campaigns/{id}`                      | `check` and the detail page                                         |
| `GET /v1/campaigns/{id}/metrics/overview`     | `check` and the detail page                                         |
| `POST /v1/campaigns/{id}/stop`                | `check` and the Stopped example                                     |
| `activate`, `reject_meta`, `set_spend`, `end` | harness, in-process or `POST /__emulator/campaigns/{id}/transition` |
| `setWallet`                                   | `check`, for the 402 retry                                          |

Also implemented by the emulator and unused here: `GET /v1/strategies`, `POST /__emulator/wallet`, `POST /__emulator/reset`.

## Errors

`check` asserts `402 insufficient_credit`. The other rows are what the emulator returns. They are not asserted in `check`.

| Case                                                 | Status | Code                       |
| ---------------------------------------------------- | ------ | -------------------------- |
| Wallet below the committed debit                     | 402    | `insufficient_credit`      |
| Missing or empty `Idempotency-Key` on create or stop | 400    | `invalid_request`          |
| Same key, different body                             | 409    | `idempotency_key_conflict` |
| `dailyBudget` below 10                               | 422    | `invalid_daily_budget`     |
| Bad `durationDays`                                   | 422    | `invalid_duration_days`    |
| Missing or wrong API key                             | 401    | `invalid_api_key`          |

Stop hashes `{ campaignId }` only. Stopping while `creating` is `400` and releases the key. A second stop on `stopped` or `ended` does not refund again.

## Not production

- Listen binds `127.0.0.1` only. Harness routes have no auth.
- Genre, Spotify URL shape, and `strategyType` are not validated. A value production would reject with `422` can return `201` here.
- Overview ignores the date query. Invalid date order is not a `400`.
- Pixels, soundlinks, budget increases, tiers, activity, and JSONL exports are not implemented.
- `campaignUrl` on detail points at a placeholder host. It is not a live dashboard for these ids.
