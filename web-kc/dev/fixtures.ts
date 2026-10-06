// Synthetic messages shaped like what our publishers really send (titles, icons, markdown, priorities).
const now = Math.floor(Date.now() / 1000);
const ago = (min: number) => now - min * 60;
let n = 0;
const id = () => `mock${(n++).toString().padStart(4, "0")}`;

const ICON = {
  kudtrading: "https://trading.kudcrafts.com/icons/icon-192.png",
  facemap: "https://facemap.fyi/logo-200x200.png",
  datacuan: "https://datacuan.com/datacuan.png",
  glitchtip: "https://glitchtip.com/assets/home/glitchtip-g.png",
  coolify: "https://server.kudcrafts.com/coolify-transparent.png",
  typemap: "",
};

export const catalog = {
  version: Date.now(),
  base_url: "",
  history_days: 90,
  sync_topic: "st_mocksync",
  apps: [
    { id: "coolify", name: "Coolify", icon: ICON.coolify, sound: "default", topics: [{ topic: "coolify", name: "", sound: "default", permission: "read-only" }] },
    {
      id: "datacuan",
      name: "Datacuan",
      icon: ICON.datacuan,
      sound: "default",
      topics: [
        { topic: "datacuan", name: "", sound: "default", permission: "read-write" },
        { topic: "datacuan-credits", name: "Credits", sound: "default", permission: "read-write" },
      ],
    },
    {
      id: "facemap",
      name: "FaceMap",
      icon: ICON.facemap,
      sound: "default",
      topics: [
        { topic: "facemap-alerts", name: "Alerts", sound: "urgent", permission: "read-write" },
        { topic: "facemap-ops", name: "Ops", sound: "default", permission: "read-write" },
        { topic: "facemap-orders", name: "Orders", sound: "alert", permission: "read-write" },
      ],
    },
    { id: "glitchtip", name: "GlitchTip", icon: ICON.glitchtip, sound: "alert", topics: [{ topic: "glitchtip", name: "", sound: "alert", permission: "read-only" }] },
    { id: "kudtrading", name: "Kudtrading", icon: ICON.kudtrading, sound: "default", topics: [{ topic: "kudtrading", name: "", sound: "default", permission: "read-write" }] },
    {
      id: "typemap",
      name: "TypeMap",
      icon: ICON.typemap,
      sound: "default",
      topics: [
        { topic: "typemap-ops", name: "Ops", sound: "default", permission: "read-write" },
        { topic: "typemap-sales", name: "Sales", sound: "alert", permission: "read-write" },
      ],
    },
  ],
};

type M = Record<string, unknown>;
const msg = (topic: string, minutesAgo: number, fields: M): M => ({ id: id(), time: ago(minutesAgo), event: "message", topic, ...fields });

export const messages: M[] = [
  msg("glitchtip", 3, {
    title: "TypeError in createOrder",
    priority: 5,
    tags: ["rotating_light", "facemap"],
    icon: ICON.glitchtip,
    content_type: "text/markdown",
    click: "https://glitchtip.example/kudcrafts/issues/1482",
    message:
      "**TypeError: Cannot read properties of undefined (reading 'id')**\n\n- **Project:** facemap\n- **Culprit:** `api/orders.ts` in `createOrder`\n- **Environment:** production\n- **Events:** 37 in the last 10 minutes\n\n[View issue FACEMAP-2K](https://glitchtip.example/kudcrafts/issues/1482)",
    actions: [
      { action: "view", label: "View issue", url: "https://glitchtip.example/kudcrafts/issues/1482" },
      { action: "http", label: "Resolve", url: "https://glitchtip.example/api/resolve/1482", method: "POST" },
    ],
  }),
  msg("facemap-orders", 9, {
    title: "New order · Rp 349.000",
    priority: 3,
    tags: ["moneybag"],
    icon: ICON.facemap,
    message: "Paket Glow Up — Dinda Pratiwi\nPaid via QRIS (Midtrans) · order fm_8KQ2",
    click: "https://facemap.fyi/admin/orders/fm_8KQ2",
  }),
  msg("coolify", 14, {
    title: "Deployment succeeded · facemap-web",
    priority: 2,
    tags: ["white_check_mark"],
    icon: ICON.coolify,
    message: "App: facemap-web (FaceMap / production)\nCommit 3f9c2ab — fix: order total rounding\nhttps://server.kudcrafts.com/project/fm/deployment/41",
  }),
  msg("kudtrading", 26, {
    title: "📦 Warehouse batch submitted · hfparts",
    priority: 3,
    tags: ["information_source", "warehouse", "hfparts"],
    icon: ICON.kudtrading,
    content_type: "text/markdown",
    click: "https://trading.kudcrafts.com/hfparts/warehouse/batches/cmuwi5bje",
    message:
      "**Batch #2291** submitted by **Rizky**\n\n| Item | Qty | Bin |\n|---|---:|---|\n| Brake pad HF-221 | 40 | A-03 |\n| Oil filter OF-9 | 120 | B-11 |\n| Spark plug SP-4 | 64 | B-02 |\n\nAwaiting QC.",
  }),
  msg("typemap-sales", 41, { title: "Payment received · Rp 199.000", priority: 3, tags: ["moneybag"], message: "Pro plan, yearly — doku\nraka@studio.id" }),
  msg("facemap-alerts", 55, {
    title: "Checkout error rate 8.4%",
    priority: 4,
    tags: ["warning"],
    icon: ICON.facemap,
    message: "Above the 5% threshold for 10 minutes. Most failures: DOKU VA timeout.",
    click: "https://facemap.fyi/admin/analytics/funnel",
    actions: [{ action: "view", label: "Open funnel", url: "https://facemap.fyi/admin/analytics/funnel" }],
  }),
  msg("datacuan-credits", 80, { title: "Credits low · 1,200 left", priority: 4, tags: ["battery"], icon: ICON.datacuan, message: "Shopee scraping credits will run out in about 2 days at the current rate." }),
  msg("coolify", 130, {
    title: "High disk usage · vienna-1",
    priority: 4,
    tags: ["floppy_disk"],
    icon: ICON.coolify,
    message: "Server: vienna-1\nDisk usage: 91% (threshold 80%)\nhttps://server.kudcrafts.com/server/eokos0g",
  }),
  msg("facemap-orders", 190, { title: "New order · Rp 249.000", tags: ["moneybag"], icon: ICON.facemap, message: "Paket Basic — Andi S.\nPaid via VA BCA (DOKU) · order fm_8KP9", click: "https://facemap.fyi/admin/orders/fm_8KP9" }),
  msg("typemap-ops", 260, { title: "Nightly report generated", priority: 2, tags: ["memo"], message: "412 personality reports rendered, 0 failures.", attachment: { name: "typemap-nightly-2026-10-06.csv", type: "text/csv", size: 48213, url: "https://example.com/report.csv" } }),
  msg("facemap-ops", 320, { title: "Regeneration queue drained", priority: 2, icon: ICON.facemap, message: "All 14 pending regenerations finished in 6m 12s." }),
  msg("glitchtip", 60 * 20, {
    title: "Pipeline failed at LiveDataFetchStage",
    priority: 4,
    tags: ["warning", "datacuan"],
    icon: ICON.glitchtip,
    content_type: "text/markdown",
    message: "**ShopeeApiError: API returned non-success status**\n\nProject: datacuan · Environment: production\n\n[View issue DATACUAN-7](https://glitchtip.example/kudcrafts/issues/7)",
  }),
  msg("kudtrading", 60 * 22, { title: "Invoice paid · PT Sinar Jaya", tags: ["white_check_mark"], icon: ICON.kudtrading, message: "INV-2026-0912 · Rp 18.450.000 settled to BCA." }),
  msg("datacuan", 60 * 26, { title: "Weekly export ready", priority: 3, tags: ["inbox_tray"], icon: ICON.datacuan, message: "Category report for 'Skincare' is ready to download." }),
  msg("coolify", 60 * 30, { title: "Deployment failed · typemap-web", priority: 5, tags: ["x"], icon: ICON.coolify, message: "Build step `bun run build` exited with code 1.\nhttps://server.kudcrafts.com/project/tm/deployment/12" }),
  msg("facemap-orders", 60 * 49, { title: "Refund issued · Rp 349.000", priority: 3, tags: ["money_with_wings"], icon: ICON.facemap, message: "Order fm_8JZ1 refunded at customer request." }),
  msg("typemap-sales", 60 * 75, { title: "Payment received · Rp 99.000", tags: ["moneybag"], message: "Starter plan, monthly — qris" }),
  msg("kudtrading", 60 * 100, { title: "Stock below minimum · OF-9", priority: 4, tags: ["warning"], icon: ICON.kudtrading, message: "Oil filter OF-9: 18 left (minimum 50)." }),
  msg("facemap-alerts", 60 * 140, { title: "Midtrans webhook latency normal", priority: 2, tags: ["green_circle"], icon: ICON.facemap, message: "p95 back under 800 ms." }),
  msg("datacuan-credits", 60 * 200, { title: "Credits topped up", tags: ["credit_card"], icon: ICON.datacuan, message: "+50,000 credits added by hammas." }),
];

