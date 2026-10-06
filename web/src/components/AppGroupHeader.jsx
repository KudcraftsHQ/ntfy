// kudcrafts: catalog -- grouping of catalog subscriptions by app in the navigation drawer
import * as React from "react";
import { Avatar, ListSubheader } from "@mui/material";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";

export const AppGroupHeader = ({ name, icon }) => (
  <ListSubheader sx={{ display: "flex", alignItems: "center", gap: 1, lineHeight: "36px" }}>
    {icon && <Avatar src={icon} alt="" variant="rounded" sx={{ width: 20, height: 20 }} />}
    {name}
  </ListSubheader>
);

/** Icon for a subscription row: the catalog app icon if there is one, else the stock chat bubble. */
export const SubscriptionAppIcon = ({ subscription }) =>
  subscription.appIcon ? (
    <Avatar src={subscription.appIcon} alt="" variant="rounded" sx={{ width: 24, height: 24 }}>
      <ChatBubbleOutlineIcon />
    </Avatar>
  ) : (
    <ChatBubbleOutlineIcon />
  );

/**
 * Groups subscriptions by catalog app: apps sorted by name (topics by display name within each),
 * followed by the subscriptions that are not in the catalog, under no header (appId null).
 */
export const groupSubscriptionsByApp = (subscriptions) => {
  const groups = new Map();
  const ungrouped = [];
  subscriptions.forEach((s) => {
    if (!s.appId) {
      ungrouped.push(s);
      return;
    }
    if (!groups.has(s.appId)) {
      groups.set(s.appId, { appId: s.appId, name: s.appName || s.appId, icon: s.appIcon || null, subscriptions: [] });
    }
    groups.get(s.appId).subscriptions.push(s);
  });
  const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" });
  const sorted = Array.from(groups.values()).sort((a, b) => byName(a.name, b.name) || byName(a.appId, b.appId));
  sorted.forEach((g) => g.subscriptions.sort((a, b) => byName(a.topic, b.topic)));
  if (ungrouped.length > 0) {
    sorted.push({ appId: null, name: null, icon: null, subscriptions: ungrouped });
  }
  return sorted;
};
