---
"@edgway/sdk": minor
"@edgway/constants": minor
---

The admin API has `GET /me`, the signed-in identity and its role. The admin UI shows them in the sidebar footer and disables what the role can't do, with a line saying who can: a viewer can't stage, and only a publisher or owner can publish and roll back. The server's role checks are unchanged.

`GET /analytics/overview` takes an optional `hours` (1, 24 or 168; anything else is a 400). The admin overview has a range picker, requests and error-rate tiles, and its chart in the chart colors. The route tester draws each plugin's time as a waterfall with the upstream's share, and names the matched route when the gateway reports one.

The plugin catalog filters by category, and each card says what the plugin does and whether it's in use or staged. The plugin form picks its scope with radio buttons and shows the plugin as decK YAML while you fill it in.

The portal's landing page shows how to get going in three steps and a first `curl` request, against the gateway named by the new optional build variable `ZUDOKU_PUBLIC_GATEWAY_URL`. A developer's usage is a 7-day bar chart, with the numbers behind "Show as a table".
