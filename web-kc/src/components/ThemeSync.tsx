import { useMountEffect } from "../hooks/useMountEffect";
import { applyTheme, useUi } from "../store/ui";

/** Keeps <html class="dark"> in sync with the preference and the OS setting. */
export function ThemeSync() {
  useMountEffect(() => {
    const forced = new URLSearchParams(location.search).get("theme");
    if (forced === "dark" || forced === "light") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(useUi.getState().theme);
    mq.addEventListener("change", onChange);
    const unsub = useUi.subscribe((s, prev) => s.theme !== prev.theme && applyTheme(s.theme));
    return () => {
      mq.removeEventListener("change", onChange);
      unsub();
    };
  });
  return null;
}
