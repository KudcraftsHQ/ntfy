// The ntfy tag -> emoji shortcodes publishers here actually use, plus common ones.
// Unknown tags render as chips instead.
const map: Record<string, string> = {
  warning: "⚠️", rotating_light: "🚨", white_check_mark: "✅", heavy_check_mark: "✔️", x: "❌", no_entry: "⛔",
  information_source: "ℹ️", bell: "🔔", tada: "🎉", rocket: "🚀", fire: "🔥", skull: "💀", bug: "🐛",
  package: "📦", moneybag: "💰", money_with_wings: "💸", dollar: "💵", credit_card: "💳", chart_with_upwards_trend: "📈",
  chart_with_downwards_trend: "📉", shopping_cart: "🛒", truck: "🚚", email: "📧", envelope: "✉️", lock: "🔒",
  key: "🔑", hourglass: "⌛", stopwatch: "⏱️", alarm_clock: "⏰", calendar: "📅", gear: "⚙️", wrench: "🔧",
  hammer: "🔨", computer: "💻", floppy_disk: "💾", cd: "💿", whale: "🐳", zap: "⚡", boom: "💥", sparkles: "✨",
  star: "⭐", bulb: "💡", mag: "🔍", memo: "📝", clipboard: "📋", link: "🔗", partying_face: "🥳", "+1": "👍",
  "-1": "👎", thumbsup: "👍", thumbsdown: "👎", eyes: "👀", robot: "🤖", ghost: "👻", red_circle: "🔴",
  green_circle: "🟢", yellow_circle: "🟡", large_blue_circle: "🔵", small_red_triangle: "🔺", loudspeaker: "📢",
  mega: "📣", inbox_tray: "📥", outbox_tray: "📤", arrows_counterclockwise: "🔄", repeat: "🔁", heart: "❤️",
  broken_heart: "💔", cloud: "☁️", sunny: "☀️", snowflake: "❄️", battery: "🔋", electric_plug: "🔌",
  satellite: "📡", globe_with_meridians: "🌐", shield: "🛡️", construction: "🚧", hospital: "🏥", ambulance: "🚑",
  sos: "🆘", new: "🆕", up: "🆙", cool: "🆒", free: "🆓", ok: "🆗", question: "❓", exclamation: "❗",
};

export const emojiFor = (tag: string): string => map[tag] ?? "";
export const plainTags = (tags: string[] = []) => tags.filter((t) => !map[t]);
export const emojiTags = (tags: string[] = []) => tags.map(emojiFor).filter(Boolean);
