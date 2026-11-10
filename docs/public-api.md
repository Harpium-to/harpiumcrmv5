# Public API (`/api/v1`)

The public API lets you drive your wacrm instance from your own
scripts and automations — send messages, manage contacts, launch
broadcasts — without going through the dashboard UI.

> **Status:** stable. Authentication, scopes, rate limiting, the
> messages / contacts / conversations / broadcasts endpoints, and
> outbound event [webhooks](#webhooks) all ship now.

## Authentication

Every request authenticates with an **API key**, sent as a bearer
token:

```
Authorization: Bearer wacrm_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Keys are **account-scoped**: a key acts on exactly one account, the
one it was created in. There is no cross-account access.

### Creating a key

In the dashboard: **Settings → API keys → New API key**. Only
**admins and owners** can create keys.

1. Give the key a name (after the integration that will use it).
2. Grant the **scopes** it needs — nothing more (see below).
3. Copy the key. **The full key is shown exactly once.** wacrm
   stores only a SHA-256 hash, so it can never be shown again. If you
   lose it, revoke it and create a new one.

### Revoking a key

**Settings → API keys → Revoke.** Revocation is effective on the
key's next request. Revoked keys stay in the list as an audit trail.

## Scopes

A key can do only what its scopes allow — independent of who created
it. Grant the minimum.

| Scope                | Allows                                   |
| -------------------- | ---------------------------------------- |
| `messages:send`      | Send WhatsApp messages                   |
| `messages:read`      | Read messages and delivery status        |
| `contacts:read`      | List and read contacts, their notes, and the account's tags |
| `contacts:write`     | Create and update contacts; add notes    |
| `conversations:read` | List and read conversations              |
| `deals:read`         | List and read deals and pipelines        |
| `deals:write`        | Create and update deals (move stage, mark won/lost) |
| `broadcasts:send`    | Launch broadcast campaigns               |
| `webhooks:manage`    | Register and manage outbound webhooks    |

A key with **no scopes** still authenticates and can call
`GET /api/v1/me` — useful for verifying a key works.

## Response envelope

Every response uses one of two shapes:

```jsonc
// success
{ "data": { /* ... */ } }

// failure
{ "error": { "code": "forbidden", "message": "This API key is missing the 'messages:send' scope" } }
```

Branch on `error.code` (stable); `error.message` is for humans and
may be reworded.

| Status | `code`         | Meaning                                          |
| ------ | -------------- | ------------------------------------------------ |
| 401    | `unauthorized` | Missing / malformed / unknown / revoked / expired key |
| 403    | `forbidden`    | Valid key, but missing the required scope        |
| 429    | `rate_limited` | Per-key rate limit exceeded                      |
| 400    | `bad_request`  | Malformed input                                  |
| 404    | `not_found`    | No such resource                                 |
| 500    | `internal`     | Server error                                     |

## Rate limits

Requests are limited **per key**: **120 requests per minute**. On a
`429`, these headers tell you when to retry:

- `Retry-After` — seconds until the window resets
- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

> The limiter is in-memory and **per process**. A single-instance
> deploy (the common case for a self-hosted fork) is fine as-is. If
> you scale to multiple instances, swap the limiter for a shared
> store (Redis/Upstash) — see the note at the top of
> `src/lib/rate-limit.ts`. The limit is otherwise unenforced across
> instances.

## Endpoints

### `GET /api/v1/me`

Returns the account a key is bound to and the scopes it carries.
Requires only a valid key (no scope). Use it to verify a key works
and to discover its scopes.

```bash
curl https://your-crm.example.com/api/v1/me \
  -H "Authorization: Bearer wacrm_live_xxx"
```

```json
{
  "data": {
    "account": { "id": "…", "name": "Acme Inc" },
    "key": { "id": "…", "scopes": ["messages:send"] }
  }
}
```

### `POST /api/v1/messages`

Send a WhatsApp message to a phone number. Scope: `messages:send`. You
pass an **E.164 number**, not an internal id — the endpoint
finds-or-creates the contact + conversation, then sends.

```bash
curl -X POST https://your-crm.example.com/api/v1/messages \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{ "to": "+14155550123", "type": "text", "text": "Hi 👋" }'
```

`type` is `text` (default), `template`, or a media kind (`image` /
`video` / `document` / `audio`). Media needs `media_url` (and optional
`filename`); `text` doubles as the caption. `template` needs a
`template` object:

```jsonc
{
  "to": "+14155550123",
  "type": "template",
  "template": {
    "name": "order_update",
    "language": "en_US",
    "params": ["A123"]        // positional body vars, or a structured object
  },
  "reply_to_message_id": "<uuid>"   // optional; must be in the same conversation
}
```

Response (201):

```json
{
  "data": {
    "message_id": "…",
    "whatsapp_message_id": "wamid.…",
    "conversation_id": "…",
    "contact_id": "…",
    "contact_created": true
  }
}
```

Domain error codes beyond the table above: `whatsapp_not_configured`
(400), `meta_error` (502 — the request reached Meta and it rejected the
send), `template_malformed` (500).

### `GET /api/v1/contacts`

List contacts, newest first. Scope: `contacts:read`. Paginated (see
[Pagination](#pagination)). Optional filters: `?search=` (matches name
or phone) and `?tag=<tagId>`.

```json
{
  "data": [
    {
      "id": "…", "phone": "+14155550123", "name": "Jane Doe",
      "email": null, "company": "Acme", "avatar_url": null,
      "temperature": "warm", "potential": 70, "segment": "Clínica",
      "source": "instagram", "city": null, "job_title": null,
      "instagram": null, "website": null,
      "tags": [{ "id": "…", "name": "vip", "color": "#3b82f6" }],
      "created_at": "…", "updated_at": "…"
    }
  ],
  "meta": { "next_cursor": "…" }
}
```

### `POST /api/v1/contacts`

Create a contact. Scope: `contacts:write`. `phone` (E.164) is required;
`name`, `email`, `company`, and `tags` (an array of tag names, created
if missing) are optional. **Find-or-create by phone:** an existing
match returns `200` with the existing contact; a new contact returns
`201`. The response body is the serialized contact (same shape as the
list rows above).

### `GET` / `PATCH /api/v1/contacts/{id}`

Read or update one contact. Scopes: `contacts:read` / `contacts:write`.
`PATCH` updates only the fields you send; pass `tags` (an array of tag
names) to replace the contact's tags. A contact in another account
returns `404`.

| Field | Accepts |
|---|---|
| `name`, `email`, `company` | string, or `null` to clear |
| `segment`, `source`, `city`, `job_title`, `instagram`, `website` | string, or `null` to clear |
| `temperature` | `"cold"`, `"warm"` or `"hot"` (cannot be cleared) |
| `potential` | integer `0`–`100`, or `null` |

A value of the wrong type or out of range is a `400`. The qualification
fields (`temperature` onward) need migration `045`; until it runs they
read as `null` and writing one returns `400` naming the field.

```bash
curl -X PATCH https://your-app/api/v1/contacts/<id> \
  -H "Authorization: Bearer $WACRM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "temperature": "hot", "potential": 80, "source": "instagram" }'
```

### `GET` / `POST /api/v1/contacts/{id}/notes`

The team's own annotations about a contact — never sent to the
customer. Scopes: `contacts:read` / `contacts:write`. A contact in
another account returns `404`.

`GET` returns the most recent notes, newest first. Not paginated:
`?limit=` (default `20`, at most `50`).

```json
{
  "data": [
    {
      "id": "…",
      "text": "Prefere contato à tarde.",
      "author": { "id": "…", "name": "Ana Lima" },
      "created_at": "…"
    }
  ]
}
```

`POST` takes `{ "text": "…" }` (required, up to 4000 characters) and
returns the new note with `201`. `author` is the person the key belongs
to — whoever created it — and `null` only if that profile is gone.

```bash
curl -X POST https://your-app/api/v1/contacts/<id>/notes \
  -H "Authorization: Bearer $WACRM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "text": "Prefere contato à tarde." }'
```

### `GET /api/v1/tags`

The account's tags, sorted by name: `{ "id", "name", "color" }`. Scope:
`contacts:read`. Not paginated. To put tags on a contact, send their
**names** as `tags` in `PATCH /api/v1/contacts/{id}`; a name that
doesn't exist yet is created.

### `GET /api/v1/conversations`

List conversations, newest first. Scope: `conversations:read`.
Paginated. Optional filters: `?status=` (`open` / `pending` / `closed`)
and `?contact_id=`. Each conversation embeds its contact + tags.

### `GET /api/v1/conversations/{id}`

Read one conversation. Scope: `conversations:read`. `404` if it belongs
to another account.

### `GET /api/v1/conversations/{id}/messages`

List a conversation's messages, newest first. Scope: `messages:read`.
Paginated. Each message includes its `direction` (`inbound` /
`outbound`), `status` (delivery state), `whatsapp_message_id`, and
`content_*`. The conversation is verified to belong to your account
first (`404` otherwise).

### `GET /api/v1/deals`

List deals, newest first. Scope: `deals:read`. Paginated. Optional
filters: `?contact_id=`, `?pipeline_id=` and `?status=` (`open` /
`won` / `lost`). Each deal embeds its pipeline and stage.

```json
{
  "data": [
    {
      "id": "…", "title": "Implante", "value": 1200.5, "currency": "BRL",
      "status": "open", "notes": null, "expected_close_date": "2026-12-01",
      "closed_at": null, "contact_id": "…", "conversation_id": null,
      "pipeline": { "id": "…", "name": "Vendas" },
      "stage": { "id": "…", "name": "Proposta", "color": "#f59e0b", "position": 1 },
      "created_at": "…", "updated_at": "…"
    }
  ],
  "meta": { "next_cursor": null }
}
```

`value` is a number. `closed_at` is when the deal reached `won` or
`lost`; it is set by the database and is `null` while the deal is open
(or on a deployment without migration `046`).

### `POST /api/v1/deals`

Open a deal for a contact. Scope: `deals:write`. Returns the deal with
`201`. It is always created `open`, in the account's default currency.

| Field | Accepts |
|---|---|
| `contact_id` | **required** — a contact of this account |
| `title` | **required** — non-empty string |
| `value` | number, `0` or more (default `0`) |
| `notes` | string |
| `expected_close_date` | `"YYYY-MM-DD"` |
| `pipeline_id` | a pipeline of this account |
| `stage_id` | a stage of a pipeline of this account |

Where it lands on the board: on `stage_id` when given (and it must be a
stage of `pipeline_id`, if you send both); otherwise on the first stage
of `pipeline_id`; with neither, on the first stage of the account's
first pipeline. An account with no pipeline gets a `400`.

```bash
curl -X POST https://your-app/api/v1/deals \
  -H "Authorization: Bearer $WACRM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "contact_id": "<contact id>", "title": "Plano anual", "value": 4800 }'
```

### `GET` / `PATCH /api/v1/deals/{id}`

Read or update one deal. Scopes: `deals:read` / `deals:write`. A deal
in another account returns `404`. `PATCH` updates only the fields you
send:

| Field | Accepts |
|---|---|
| `stage_id` | a stage of the deal's **own** pipeline (else `400`) |
| `status` | `"open"`, `"won"` or `"lost"` |
| `title` | non-empty string |
| `value` | number, `0` or more |
| `notes` | string, or `null` to clear |
| `expected_close_date` | `"YYYY-MM-DD"`, or `null` to clear |

```bash
curl -X PATCH https://your-app/api/v1/deals/<id> \
  -H "Authorization: Bearer $WACRM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "stage_id": "<stage id>" }'
```

### `GET /api/v1/pipelines`

Every pipeline with its stages in board order. Scope: `deals:read`.
Not paginated. Use a stage `id` from here as `stage_id` above.

### `POST /api/v1/broadcasts`

Launch a template broadcast to a list of recipients. Scope:
`broadcasts:send`. The broadcast + its recipient rows are persisted
immediately and the sends fan out in the background, so the call
returns fast — poll `GET /api/v1/broadcasts/{id}` for progress.

```bash
curl -X POST https://your-crm.example.com/api/v1/broadcasts \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
        "name": "July promo",
        "template_name": "promo_july",
        "template_language": "en_US",
        "recipients": [
          { "to": "+14155550123", "params": ["Jane"] },
          { "to": "+14155550124" }
        ]
      }'
```

Recipients are capped at **1000 per request** — split larger sends.
Invalid phone numbers are dropped and counted as `rejected`. Response
(202):

```json
{
  "data": {
    "broadcast_id": "…",
    "status": "sending",
    "total_recipients": 2,
    "accepted": 2,
    "rejected": 0
  }
}
```

### `GET /api/v1/broadcasts/{id}`

Broadcast status + counts. Scope: `broadcasts:send`. `status` moves
`sending` → `sent`; `delivered_count` / `read_count` keep climbing as
Meta delivery webhooks arrive. `404` for another account's broadcast.

## Pagination

Every list endpoint pages the same way. Request a page size with
`?limit=` (default 50, max 100) and read the next page with the opaque
`meta.next_cursor` from the previous response:

```
GET /api/v1/contacts?limit=50
→ { "data": [ … ], "meta": { "next_cursor": "eyJ…" } }

GET /api/v1/contacts?limit=50&cursor=eyJ…
→ { "data": [ … ], "meta": { "next_cursor": null } }   // last page
```

Cursors are keyset-based (stable under concurrent inserts). Pass the
cursor back verbatim — don't parse it. `next_cursor: null` means the
last page.

## Webhooks

Rather than polling, register an endpoint and wacrm will POST to it when
things happen in your account. **Migration required:** apply
`supabase/migrations/028_webhook_endpoints.sql`.

### Events

| Event                    | Fires when                                        |
| ------------------------ | ------------------------------------------------- |
| `message.received`       | An inbound message arrives from a contact         |
| `message.status_updated` | A message you sent changed delivery status        |
| `conversation.created`   | A new conversation is opened for a contact        |

### Managing endpoints

All under scope `webhooks:manage`.

- `POST /api/v1/webhooks` — register `{ "url": "https://…", "events": ["message.received"] }`. `url` must be `https://`. **The response includes `secret` exactly once** — store it to verify signatures; wacrm keeps only an encrypted copy.
- `GET /api/v1/webhooks` — list your endpoints (never returns the secret).
- `GET /api/v1/webhooks/{id}` — read one.
- `PATCH /api/v1/webhooks/{id}` — update `url`, `events`, or `is_active` (re-enabling clears the failure counter).
- `DELETE /api/v1/webhooks/{id}` — remove one.

```bash
curl -X POST https://your-crm.example.com/api/v1/webhooks \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://example.com/hooks/wacrm", "events": ["message.received"] }'
# → 201 { "data": { "id": "…", "url": "…", "events": [...], "secret": "whsec_…" } }
```

### Delivery payload

Every delivery is a POST with this envelope; `id` is a unique per-
delivery uuid you can dedupe on, and `data` varies by `event`:

```json
{
  "id": "8f3c…",
  "event": "message.received",
  "occurred_at": "2026-07-01T12:00:00.000Z",
  "account_id": "…",
  "data": { /* per-event, see below */ }
}
```

`data` by event:

```jsonc
// message.received
{ "conversation_id": "…", "contact_id": "…", "whatsapp_message_id": "wamid.…", "content_type": "text", "text": "Hi 👋" }
// conversation.created
{ "conversation_id": "…", "contact_id": "…" }
// message.status_updated
{ "whatsapp_message_id": "wamid.…", "conversation_id": "…", "status": "delivered" }
```

Headers: `X-Wacrm-Event`, `X-Wacrm-Webhook-Id`, and `X-Wacrm-Signature`.

### Verifying the signature

`X-Wacrm-Signature: t=<unix_seconds>,v1=<hex>` where `v1 =
HMAC-SHA256(secret, "${t}.${rawBody}")`. Recompute it over the **raw
request body** and compare in constant time; reject if `t` is more than
a few minutes old (replay protection).

```js
const [, t, v1] = header.match(/t=(\d+),v1=([0-9a-f]+)/);
const expected = crypto.createHmac('sha256', secret)
  .update(`${t}.${rawBody}`).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
```

### Delivery semantics

Delivery is **best-effort**: a single attempt per event with a short
timeout, and **redirects are not followed**. `message.status_updated`
covers messages wacrm stores (inbox + API sends), not broadcast-only
sends, and — because providers re-send and re-order status callbacks —
the same status may arrive more than once or out of order; **dedupe on
`id` and don't assume ordering**. Each consecutive failure increments
`failure_count`; after enough consecutive failures the endpoint is
auto-disabled (`is_active: false`) — re-enable it with `PATCH` (which
resets the counter). Durable retry-with-backoff (a delivery queue) is a
future enhancement; today, treat missed deliveries as possible and
reconcile with the read endpoints when it matters.

**Target restrictions (SSRF).** The `url` must be `https://` and must
resolve to a public address — requests to `localhost`, private/RFC1918
ranges, link-local (incl. cloud metadata `169.254.169.254`), and similar
internal targets are refused at delivery time.

## Roadmap

The public API now covers messaging, contacts, conversations, deals
and pipelines (read, move, close), broadcasts, and outbound webhooks.
Future ideas (creating deals, templates, flows, a delivery queue for
webhooks) are not yet scheduled.
