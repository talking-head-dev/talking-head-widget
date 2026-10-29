/**
 * The `<script>` tag build: `window.TalkingHeadWidget` (with `mount`), and a widget mounted at once from the script
 * tag's `data-*` attributes when it has `data-head` or `data-clips`:
 *
 * ```html
 * <script src="talking-head-widget.iife.js" data-head="/heads/eve.web.glb"
 *   data-clips='{"welcome": "/clips/welcome.clip.json"}' data-autoplay="muted" async></script>
 * ```
 */
import { TalkingHeadWidget, type WidgetOptions } from "./widget/TalkingHeadWidget";

export { TalkingHeadWidget };
export const mount = (options?: WidgetOptions) => TalkingHeadWidget.mount(options);

/** Widget options from a script tag's `data-*` attributes (`data-clips` and `data-offset` are JSON). */
export function optionsFromDataset(data: DOMStringMap): WidgetOptions {
  const options: WidgetOptions = {};
  const json = (key: string) => {
    try {
      return JSON.parse(data[key]!);
    } catch {
      console.warn(`talking-head-widget: data-${key} isn't JSON`);
      return undefined;
    }
  };
  const bool = (v: string) => v !== "false" && v !== "0";
  if (data.head) options.head = data.head;
  if (data.clips) options.clips = json("clips");
  if (data.position) options.position = data.position as WidgetOptions["position"];
  if (data.size) options.size = Number(data.size);
  if (data.offset) options.offset = json("offset");
  if (data.zIndex) options.zIndex = Number(data.zIndex);
  if (data.autoplay) options.autoplay = data.autoplay === "false" ? false : (data.autoplay as WidgetOptions["autoplay"]);
  if (data.captions) options.captions = bool(data.captions);
  if (data.idle) options.idle = bool(data.idle);
  if (data.load) options.load = data.load as WidgetOptions["load"];
  if (data.poster) options.poster = data.poster;
  return options;
}

const script = document.currentScript as HTMLScriptElement | null;
if (script && (script.dataset.head || script.dataset.clips)) {
  const start = () => {
    const widget = TalkingHeadWidget.mount(optionsFromDataset(script.dataset));
    (window as Window & { talkingHeadWidget?: TalkingHeadWidget }).talkingHeadWidget = widget;
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
}
