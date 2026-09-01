# socmed HTTP API

A token-authenticated API for driving socmed from an external automation tool
(Zapier, Make, n8n, cron, a shell script).

## Authentication

Create a token at **API tokens** in the sidebar (admin only). The secret is shown
once and never again — only its SHA-256 hash is stored, so a leaked database
does not yield usable tokens.

```
Authorization: Bearer socmed_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Every endpoint below also accepts a normal session cookie, so the same routes
back the web UI.

### What a token can and cannot do

Tokens carry a role and cap out at **editor**:

| Role | Can |
|---|---|
| `editor` | Read, and create/update/schedule/publish posts and schedule rules |
| `viewer` | Read only |

**Not reachable with a token, by design:** connecting or removing accounts,
managing users, managing tokens themselves, setup and key generation. These
handle credentials or other people's access, and a long-lived static token is
the wrong instrument for them. A token also cannot mint another token — that
would turn a leak into a foothold surviving revocation of the original.

Approve/reject in the review workflow requires admin, so it is likewise
cookie-only.

### Failure modes

| Status | Meaning |
|---|---|
| `401` | No credentials, or the token is unknown, revoked or expired |
| `403` | Authenticated, but the role is insufficient |

An unknown, revoked and expired token are deliberately indistinguishable —
telling them apart would reveal which tokens exist.

---

## Posts

### `GET /api/posts`

Every post, newest first. Add `?review=pending` for the review queue only.

```bash
curl -H "Authorization: Bearer $TOKEN" https://social.example.com/api/posts
```

### `GET /api/posts?id=123`

One post with its media attached.

### `POST /api/posts`

Dispatches on an `action` field. Omitting it means `create`.

#### Create

```bash
curl -X POST https://social.example.com/api/posts \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "accountIds": [1, 2, 3],
    "kind": "text",
    "caption": "New post on the blog",
    "hashtags": "#engineering",
    "linkUrl": "https://example.com/blog/post",
    "campaign": "launch",
    "firstComment": "#more #hashtags",
    "scheduledFor": 1789000000
  }'
```

| Field | Notes |
|---|---|
| `accountIds` | One post row is created per account. `accountId` (singular) is still accepted. |
| `kind` | `text` \| `image` \| `video` \| `carousel` \| `link` |
| `mediaIds` | Ids from `/api/media/library`. Upload is cookie-only (multipart). |
| `scheduledFor` | Unix **seconds**. Omit or use a past time for a draft. |
| `campaign` | Feeds `utm_campaign` when the post publishes. |
| `firstComment` | Posted right after publishing, where supported. |

```json
{ "ids": [11, 12, 13], "id": 11, "status": "scheduled", "reviewStatus": "none" }
```

The fan-out is one transaction: if any `accountIds` entry does not exist, the
request is rejected with `404` and **nothing** is created.

If `SOCMED_REQUIRE_APPROVAL` is on, an editor token's post is held at
`status: "draft"`, `reviewStatus: "pending"` and is not queued until an admin
approves it in the UI.

#### Update

```json
{ "action": "update", "id": 11, "caption": "Fixed a typo", "scheduledFor": 1789003600 }
```

Rescheduling cancels the previously queued publish, so a post edited twice does
not go out twice. Published posts are rejected with `409`.

#### Publish now

```json
{ "action": "publish_now", "id": 11 }
```

#### Delete

```json
{ "action": "delete", "id": 11 }
```

---

## Schedule rules

### `GET /api/schedules`

Recurring rules with their next run time.

### `POST /api/schedules`

```json
{
  "accountId": 1,
  "name": "Monday evergreen",
  "cronExpr": "0 9 * * 1",
  "timezone": "Asia/Jakarta",
  "templatePostId": 42
}
```

Standard 5-field cron. `timezone` is any IANA zone and is honoured across DST.
Also supports `{"action": "update"|"run_now"|"delete", "id": N}`.

---

## Analytics

### `GET /api/analytics/overview`

| Param | Notes |
|---|---|
| `days` | Rolling window, default 30, max 365 |
| `from`, `to` | Unix seconds. Override `days`. `to` alone is rejected. |
| `accountId` | Restrict to one account |

Returns `totals`, `timeseries`, `byPlatform`, `byAccount` and `top`.

### `GET /api/analytics/export`

Same parameters, returns CSV with RFC 4180 quoting.

### `GET /api/analytics/best-time`

Best-performing publish slots from the account's own history. Pass `tz` for the
timezone the buckets should be computed in, and `accountId` to narrow it.

---

## Media

### `GET /api/media/library`

`q` searches alt text, filename and mime. `kind` filters `image`/`video`.
`limit` and `offset` page; the unfiltered `total` comes back alongside.

Uploading is multipart and cookie-only for now.

---

## Links

### `GET /api/links`

Short links minted at publish time, with click counts.

---

## Health

### `GET /api/health`

Unauthenticated. Returns database status and queue counters.
