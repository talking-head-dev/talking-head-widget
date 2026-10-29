/**
 * `@talking-head-dev/widget`: an embeddable 3D talking head that plays clips made in the talking-head.dev studio.
 *
 * ```js
 * import { TalkingHeadWidget } from "@talking-head-dev/widget";
 * const head = TalkingHeadWidget.mount({ head: "/heads/eve.web.glb", clips: { welcome: "/clips/welcome.clip.json" } });
 * ```
 */
export {
  DEFAULT_LABELS, TalkingHeadWidget, hasWebGL, type Autoplay, type LoadWhen, type WidgetEvent, type WidgetLabels,
  type WidgetOptions, type WidgetPosition, type WidgetStats,
} from "./widget/TalkingHeadWidget";
export { CLIP_AUDIO, CLIP_FORMAT, CLIP_VERSION, ClipFormatError, loadClip, parseClip, type Clip, type ClipFile,
  type ClipWord } from "./clip";
export { captionAt, captionLines, type CaptionLine } from "./widget/captions";
