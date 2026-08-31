# Design System — socmed

Design tokens and UI conventions for the socmed web app. This is the
authoritative reference for the values defined in `app/app/globals.css`
(Tailwind 4 `@theme`) and used across `app/components`.

## Color tokens

All colors are defined as HSL triplets in `globals.css` and exposed as
Tailwind theme colors (`bg-primary`, `text-muted-foreground`, etc.).

| Token | Value | Usage |
|-------|-------|-------|
| `primary` | `hsl(222 21% 12%)` (#181d26) | Primary buttons, brand surfaces (near-black ink) |
| `primary-active` | `hsl(216 30% 7%)` | Pressed state of primary |
| `canvas` | `hsl(0 0% 100%)` | Page background |
| `ink` | `hsl(222 21% 12%)` | Body text (dark) |
| `body` | `hsl(218 10% 24%)` | Secondary text |
| `muted` | = `surface-strong` | Subtle **background** fills — tab rails, separators (shadcn `bg-muted`) |
| `muted-foreground` | `hsl(220 6% 28%)` | Muted **text** / icons that sit on top of a `muted`/regular background (shadcn `text-muted-foreground`) |
| `hairline` | `hsl(0 0% 87%)` | Borders, dividers |
| `border-strong` | `hsl(220 8% 60%)` | Strong borders |
| `surface-soft` | `hsl(210 40% 98%)` | Soft fills, hover |
| `surface-strong` | `hsl(210 7% 89%)` | Raised surfaces |
| `surface-dark` | `hsl(222 21% 12%)` | Dark surfaces |
| `link` | `hsl(216 76% 45%)` | Links |
| `info-border` | `hsl(216 100% 64%)` | Focus rings |
| `success` | `hsl(120 100% 20%)` | Success states |
| `destructive` | `hsl(16 100% 33%)` | Danger, delete |
| `signature-coral` | `hsl(15 100% 33%)` | Brand accent |
| `signature-forest` | `hsl(135 66% 11%)` | Brand accent |
| `signature-cream` | `hsl(38 59% 89%)` | Brand accent |

## Radius scale

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | 6px | Inputs, small controls |
| `--radius-md` | 10px | Cards |
| `--radius-lg` | 12px | Primary buttons |
| `--radius-pill` | 9999px | Pills, avatars, icon buttons |

## Typography

- Font stack: Inter (via `--font-sans`), with system fallbacks.
- Base size: 14px on `body`.
- Headings: weight 500, `letter-spacing: -0.01em` (display never bolder than 500).

## Color usage rules

- Always use the semantic tokens above (`text-destructive`, `bg-success/10`,
  `text-link`, `signature-*`, …) — never raw Tailwind palette utilities
  (`text-red-700`, `bg-green-50`, `bg-blue-600`, `border-amber-300`, etc.).
  Raw palette classes drift from the palette the moment someone tweaks a
  token and are the main source of inconsistent text/badge colors across
  pages. Status banners use `bg-<token>/10 text-<token>` (see
  `AccountsView`, `ComposeView`, `InboxView`); the `warning` family uses
  `signature-cream` / `signature-mustard`, not `amber-*`.
- `muted` and `muted-foreground` are different roles (a light background vs.
  the darker text that sits on it) — never give them the same value. They
  shipped identical once, which silently made any `text-muted-foreground`
  invisible against a `bg-muted` background (`<Tabs>`'s `TabsList` sets both
  on one element, so the inactive tab's label disappeared). If you add a new
  semantic pair like this, sanity-check contrast between its `-foreground`
  and non-`-foreground` values, not just against `canvas`/`ink`.
- Platform brand colors (`PLATFORMS[].bg` in `platform-meta.ts`) are either a
  solid `bg-[#hex]` or, for Instagram only, a full gradient
  (`bg-gradient-to-tr from-[..] via-[..] to-[..]`). Don't append an
  unconditional `bg-gradient-to-*` direction class next to `p.bg` in a
  className that passes through `cn()`/`tailwind-merge` — twMerge treats
  solid `bg-*` and `bg-gradient-to-*` as the same conflict group and keeps
  only the last one in the string, silently dropping the platform's actual
  color for every non-gradient platform (this shipped as a real bug once:
  11 of 12 platform cards rendered with a blank white header). Only add a
  gradient utility when the color source itself supplies gradient stops.

## Layout & routing

- Every authenticated route must live under `app/(authed)/` so it inherits
  the sidebar shell from `app/(authed)/layout.tsx`. A page placed at
  `app/app/page.tsx` (outside the group) still passes its own session
  check but renders with no nav/sidebar at all — the route group, not the
  session check, is what pulls in the shared layout.
- Page headers follow one fixed pattern, set by `app/(authed)/*/page.tsx`:
  `<h1 className="text-2xl font-semibold">` + `<p className="text-sm
  text-muted-foreground">`. Don't introduce a different size/weight for a
  one-off page (e.g. the home page previously used `text-3xl font-bold`,
  inconsistent with every other page).

## Components

- **Button** — primary: near-black (`bg-primary`), 12px radius, h-11; outline:
  white with hairline border; ghost: transparent with soft hover; icon: 40px circle.
- **Card** — 10px radius, hairline border, no shadow (`Card`, `CardHeader`, `CardContent`…).
- **Input / Textarea** — 44px height, 6px radius, hairline border, focus ring in
  `info-border` blue.
- **Badge** — pill, `default | secondary | destructive | outline | success | warning`.

## Dark mode

The `.dark` class toggles a dark palette (defined in `globals.css` under
`.dark`). Tailwind 4 variant: `@custom-variant dark (&:is(.dark *))`.

## Brand

- Wordmark: "socmed" in `font-medium`, near-black on light surfaces.
- Platform colors live in `app/lib/platform-meta.ts` (single source of truth
  for the 12 supported platforms).
