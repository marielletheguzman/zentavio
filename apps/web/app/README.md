# app

> **Purpose:** App Router route tree (marketing, auth, dashboard segments, BFF api handlers).

```text
layout.tsx · globals.css
page.tsx              + resume/upload-panel.tsx   upload, and correct what was extracted
gap/page.tsx          + gap/gap-panel.tsx         choose a track, see the gap and readiness
```

**The panels are markup and a fetch.** Every state decision lives in `../lib`, which is pure and
tested — a state that lives only in JSX gets tested by clicking.

Of the purpose line above, two routes are filled. **Marketing, auth segments, and BFF api handlers
do not exist**: there is no session to build an auth segment around yet (ADR-0017 is implemented but
needs a provider), and a BFF route would be a second place that talks to the gateway. Today the
panels call it directly.
