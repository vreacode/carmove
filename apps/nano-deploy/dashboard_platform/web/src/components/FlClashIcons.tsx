/* SPDX-License-Identifier: GPL-3.0-only
 * SVG adapters of FlClash AppGlyphs (be84736) / prism_ui Glyphs (63450c0).
 * Rounded-polyline coordinates and 1.8px strokes follow upstream. GlyphBox's
 * Flutter superellipse is represented by SVG rounded rectangles.
 * See public/licenses/flclash/NOTICE.md and GPL-3.0.txt.
 */
import type { SVGProps } from "react";

const paths: Record<string, string> = {
  "ArrowDownTrayIcon": "<path d=\"M 8.4 10.5 L 6.5 10.5 Q 5 10.5 5 12 L 5 18.2 Q 5 21 7.8 21 L 16.2 21 Q 19 21 19 18.2 L 19 12 Q 19 10.5 17.5 10.5 L 15.6 10.5\"/><path d=\"M 12 15.6 L 12 3\"/><path d=\"M 8.2 6.8 L 11.7172 3.2828 Q 12 3 12.2828 3.2828 L 15.8 6.8\"/>",
  "ArchiveBoxIcon": "<rect x=\"3\" y=\"3.5\" width=\"18\" height=\"5\" rx=\"1.8\"/><rect x=\"4.5\" y=\"10.8\" width=\"15\" height=\"9.7\" rx=\"2.2\"/><path d=\"M 10 14.2 L 14 14.2\"/>",
  "ArrowLeftIcon": "<path d=\"M 5 12 L 19 12\"/><path d=\"M 11.5 5.5 L 5.2828 11.7172 Q 5 12 5.2828 12.2828 L 11.5 18.5\"/>",
  "ArrowPathIcon": "<path d=\"M 18.4347 16.373 A 7.78 7.78 0 1 1 18.9974 8.5992\"/><path d=\"M 19 5 L 19 8.2 Q 19 8.6 18.6 8.6 L 15.4 8.6\"/>",
  "ArrowUpRightIcon": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"3\"/><path d=\"M 7.6 16.4 L 16.4 7.6\"/><path d=\"M 11 7.6 L 16 7.6 Q 16.4 7.6 16.4 8 L 16.4 13\"/>",
  "BoltIcon": "<path d=\"M 13.843 3.5539 L 5.657 12.9461 Q 5 13.7 6 13.7 L 10.6 13.7 Q 11.2 13.7 11.0674 14.2852 L 9.7211 20.2247 Q 9.5 21.2 10.157 20.4461 L 18.343 11.0539 Q 19 10.3 18 10.3 L 13.4 10.3 Q 12.8 10.3 12.9326 9.7148 L 14.2789 3.7753 Q 14.5 2.8 13.843 3.5539 Z\"/>",
  "BookOpenIcon": "<rect x=\"3\" y=\"3.5\" width=\"18\" height=\"5\" rx=\"1.8\"/><rect x=\"4.5\" y=\"10.8\" width=\"15\" height=\"9.7\" rx=\"2.2\"/><path d=\"M 10 14.2 L 14 14.2\"/>",
  "CameraIcon": "<path d=\"M 5.6 7.5 L 7.6 7.5 Q 8.2 7.5 8.4932 6.9765 L 9.2091 5.698 Q 9.6 5 10.4 5 L 13.6 5 Q 14.4 5 14.7909 5.698 L 15.5068 6.9765 Q 15.8 7.5 16.4 7.5 L 18.4 7.5 Q 21 7.5 21 10.1 L 21 16.9 Q 21 19.5 18.4 19.5 L 5.6 19.5 Q 3 19.5 3 16.9 L 3 10.1 Q 3 7.5 5.6 7.5 Z\"/><circle cx=\"12\" cy=\"13.4\" r=\"3.4\"/>",
  "ChartBarIcon": "<path d=\"M10 14 H15.8 Q17 14 16.897 15.194 A7 7 0 1 1 8.806 7.103 Q10 7 10 8.2 Z\"/><path d=\"M13.6 9.4 V4.6 Q13.6 3.4 14.794 3.503 A7 7 0 0 1 20.497 9.206 Q20.6 10.4 19.4 10.4 H14.6 Q13.6 10.4 13.6 9.4 Z\"/>",
  "CheckCircleIcon": "<circle cx=\"12\" cy=\"12\" r=\"8.8\"/><path d=\"M 7.59 12.3 L 10.49 15.2 Q 10.49 15.2 10.49 15.2 L 16.41 8.79\"/>",
  "ChevronDownIcon": "<path d=\"M 5.5 8.75 L 11.7172 14.9672 Q 12 15.25 12.2828 14.9672 L 18.5 8.75\"/>",
  "ChevronLeftIcon": "<path d=\"M 15.25 5.5 L 9.0328 11.7172 Q 8.75 12 9.0328 12.2828 L 15.25 18.5\"/>",
  "ChevronRightIcon": "<path d=\"M 8.75 5.5 L 14.9672 11.7172 Q 15.25 12 14.9672 12.2828 L 8.75 18.5\"/>",
  "ChevronUpIcon": "<path d=\"M 5.5 15.25 L 11.7172 9.0328 Q 12 8.75 12.2828 9.0328 L 18.5 15.25\"/>",
  "CircleStackIcon": "<rect x=\"3.5\" y=\"7.2\" width=\"17\" height=\"9.6\" rx=\"2.5\"/><path d=\"M 8 7.2 L 8 3.8\"/><path d=\"M 12 7.2 L 12 3.8\"/><path d=\"M 16 7.2 L 16 3.8\"/><path d=\"M 8 16.8 L 8 20.2\"/><path d=\"M 12 16.8 L 12 20.2\"/><path d=\"M 16 16.8 L 16 20.2\"/>",
  "ClockIcon": "<circle cx=\"12\" cy=\"12\" r=\"8.8\"/><path d=\"M 12 7.2 L 12 11.4 Q 12 12 12.5088 12.318 L 15.2 14\"/>",
  "CpuChipIcon": "<rect x=\"5.5\" y=\"5.5\" width=\"13\" height=\"13\" rx=\"2.2\"/><rect x=\"9.2\" y=\"9.2\" width=\"5.6\" height=\"5.6\" rx=\"1.2\"/><path d=\"M 8.4 5.5 L 8.4 2.9\"/><path d=\"M 12 5.5 L 12 2.9\"/><path d=\"M 15.6 5.5 L 15.6 2.9\"/><path d=\"M 8.4 18.5 L 8.4 21.1\"/><path d=\"M 12 18.5 L 12 21.1\"/><path d=\"M 15.6 18.5 L 15.6 21.1\"/><path d=\"M 5.5 8.4 L 2.9 8.4\"/><path d=\"M 5.5 12 L 2.9 12\"/><path d=\"M 5.5 15.6 L 2.9 15.6\"/><path d=\"M 18.5 8.4 L 21.1 8.4\"/><path d=\"M 18.5 12 L 21.1 12\"/><path d=\"M 18.5 15.6 L 21.1 15.6\"/>",
  "ExclamationTriangleIcon": "<path d=\"M 13.4037 4.2514 L 20.7303 18.0905 Q 21.9 20.3 19.4 20.3 L 4.6 20.3 Q 2.1 20.3 3.2697 18.0905 L 10.5963 4.2514 Q 12 1.6 13.4037 4.2514 Z\"/><path d=\"M 12 9 L 12 12.1\"/><circle cx=\"12\" cy=\"16.2\" r=\"1.4\" fill=\"currentColor\" stroke=\"none\"/>",
  "LockClosedIcon": "<rect x=\"5\" y=\"10.5\" width=\"14\" height=\"10.3\" rx=\"2.5\"/><path d=\"M8.5 10.5V7A3.5 3.5 0 0 1 15.5 7V10.5\"/><path d=\"M 12 14.4 L 12 17\"/>",
  "LockOpenIcon": "<rect x=\"5\" y=\"10.5\" width=\"14\" height=\"10.3\" rx=\"2.5\"/><path d=\"M8.5 10.5V7A3.5 3.5 0 0 1 15.5 7\"/><path d=\"M 12 14.4 L 12 17\"/>",
  "MagnifyingGlassIcon": "<circle cx=\"10.3\" cy=\"10.3\" r=\"6.9\"/><path d=\"M 15.18 15.18 L 20.6 20.6\"/>",
  "MapIcon": "<circle cx=\"12\" cy=\"12\" r=\"8.8\"/><ellipse cx=\"12\" cy=\"12\" rx=\"3.8\" ry=\"8.8\"/><path d=\"M 3.2 12 L 20.8 12\"/>",
  "MapPinIcon": "<circle cx=\"12\" cy=\"12\" r=\"6.2\"/><circle cx=\"12\" cy=\"12\" r=\"1.8\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M 12 2.9 L 12 5.8\"/><path d=\"M 12 18.2 L 12 21.1\"/><path d=\"M 2.9 12 L 5.8 12\"/><path d=\"M 18.2 12 L 21.1 12\"/>",
  "PhotoIcon": "<rect x=\"3\" y=\"6.4\" width=\"14.6\" height=\"14.6\" rx=\"2.6\"/><path d=\"M 6.4 3 L 18.4 3 Q 21 3 21 5.6 L 21 17.6\"/><path d=\"M 3 17.2 L 7.2343 12.9657 Q 7.8 12.4 8.3657 12.9657 L 11.6343 16.2343 Q 12.2 16.8 12.7657 16.2343 L 13.4343 15.5657 Q 14 15 14.5657 15.5657 L 17.6 18.6\"/><circle cx=\"13.4\" cy=\"10.6\" r=\"1.4\" fill=\"currentColor\" stroke=\"none\"/>",
  "RadioIcon": "<path d=\"M3.32 9.56 A13.5 13.5 0 0 1 20.68 9.56\"/><path d=\"M6.54 13.39 A8.5 8.5 0 0 1 17.46 13.39\"/><circle cx=\"12\" cy=\"18.6\" r=\"1.7\" fill=\"currentColor\" stroke=\"none\"/>",
  "ShieldCheckIcon": "<path d=\"M 13.4192 3.3855 L 17.7077 4.8526 Q 19.6 5.5 19.6 7.5 L 19.6 9 Q 19.6 12.5 16.289 16.2466 L 13.6555 19.2267 Q 12 21.1 10.3445 19.2267 L 7.711 16.2466 Q 4.4 12.5 4.4 9 L 4.4 7.5 Q 4.4 5.5 6.2923 4.8526 L 10.5808 3.3855 Q 12 2.9 13.4192 3.3855 Z\"/><path d=\"M 8.7 11.8 L 11 14.1 Q 11 14.1 11 14.1 L 15.3 9.6\"/>",
  "TrashIcon": "<path d=\"M 5.8 6.8 L 18.2 6.8 Q 18.2 6.8 18.2 6.8 L 17.3756 18.5062 Q 17.2 21 14.7 21 L 9.3 21 Q 6.8 21 6.6244 18.5062 L 5.8 6.8 Q 5.8 6.8 5.8 6.8 Z\"/><path d=\"M 10 10.5 L 10 17.5\"/><path d=\"M 14 10.5 L 14 17.5\"/><path d=\"M 3.8 6.8 L 20.2 6.8\"/><path d=\"M 9 6.8 L 9 4.6 Q 9 3.2 10.4 3.2 L 13.6 3.2 Q 15 3.2 15 4.6 L 15 6.8\"/>",
  "VideoCameraIcon": "<path d=\"M 5.6 7.5 L 7.6 7.5 Q 8.2 7.5 8.4932 6.9765 L 9.2091 5.698 Q 9.6 5 10.4 5 L 13.6 5 Q 14.4 5 14.7909 5.698 L 15.5068 6.9765 Q 15.8 7.5 16.4 7.5 L 18.4 7.5 Q 21 7.5 21 10.1 L 21 16.9 Q 21 19.5 18.4 19.5 L 5.6 19.5 Q 3 19.5 3 16.9 L 3 10.1 Q 3 7.5 5.6 7.5 Z\"/><circle cx=\"12\" cy=\"13.4\" r=\"3.4\"/>",
  "WifiIcon": "<path d=\"M3.32 9.56 A13.5 13.5 0 0 1 20.68 9.56\"/><path d=\"M6.54 13.39 A8.5 8.5 0 0 1 17.46 13.39\"/><circle cx=\"12\" cy=\"18.6\" r=\"1.7\" fill=\"currentColor\" stroke=\"none\"/>",
  "WrenchScrewdriverIcon": "<path d=\"M 9.9239 4.8424 L 10.0092 3.8964 Q 10.09 3 10.99 3 L 13.01 3 Q 13.91 3 13.9908 3.8964 L 14.0761 4.8424 Q 14.13 5.44 14.6503 5.7388 L 16.0997 6.5712 Q 16.62 6.87 17.1643 6.6175 L 18.0236 6.2188 Q 18.84 5.84 19.2888 6.6201 L 20.3012 8.3799 Q 20.75 9.16 20.0144 9.6786 L 19.2404 10.2243 Q 18.75 10.57 18.75 11.17 L 18.75 12.83 Q 18.75 13.43 19.2404 13.7757 L 20.0144 14.3214 Q 20.75 14.84 20.3012 15.6201 L 19.2888 17.3799 Q 18.84 18.16 18.0236 17.7812 L 17.1643 17.3825 Q 16.62 17.13 16.0997 17.4288 L 14.6503 18.2612 Q 14.13 18.56 14.0761 19.1576 L 13.9908 20.1036 Q 13.91 21 13.01 21 L 10.99 21 Q 10.09 21 10.0092 20.1036 L 9.9239 19.1576 Q 9.87 18.56 9.3497 18.2612 L 7.9003 17.4288 Q 7.38 17.13 6.8357 17.3825 L 5.9764 17.7812 Q 5.16 18.16 4.7112 17.3799 L 3.6988 15.6201 Q 3.25 14.84 3.9856 14.3214 L 4.7596 13.7757 Q 5.25 13.43 5.25 12.83 L 5.25 11.17 Q 5.25 10.57 4.7596 10.2243 L 3.9856 9.6786 Q 3.25 9.16 3.6988 8.3799 L 4.7112 6.6201 Q 5.16 5.84 5.9764 6.2188 L 6.8357 6.6175 Q 7.38 6.87 7.9003 6.5712 L 9.3497 5.7388 Q 9.87 5.44 9.9239 4.8424 Z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>",
  "XMarkIcon": "<path d=\"M 6 6 L 18 18\"/><path d=\"M 18 6 L 6 18\"/>",
  "DashboardIcon": "<rect x=\"3.5\" y=\"3.5\" width=\"7\" height=\"8\" rx=\"2\"/><rect x=\"13.5\" y=\"3.5\" width=\"7\" height=\"6\" rx=\"2\"/><rect x=\"3.5\" y=\"14.5\" width=\"7\" height=\"6\" rx=\"2\"/><rect x=\"13.5\" y=\"12.5\" width=\"7\" height=\"8\" rx=\"2\"/>",
  "ArrowRightIcon": "<g transform=\"rotate(180 12 12)\"><path d=\"M 5 12 L 19 12\"/><path d=\"M 11.5 5.5 L 5.2828 11.7172 Q 5 12 5.2828 12.2828 L 11.5 18.5\"/></g>",
  "PlayIcon": "<path d=\"M 9.3247 6.2246 L 17.7753 11.3754 Q 18.8 12 17.7753 12.6246 L 9.3247 17.7754 Q 8.3 18.4 8.3 17.2 L 8.3 6.8 Q 8.3 5.6 9.3247 6.2246 Z\"/>",
  "PauseIcon": "<g transform=\"rotate(90 12 12)\"><path d=\"M 7.1 6.9 L 16.9 6.9 Q 18.1 6.9 18.1 8 L 18.1 8 Q 18.1 9.1 16.9 9.1 L 7.1 9.1 Q 5.9 9.1 5.9 8 L 5.9 8 Q 5.9 6.9 7.1 6.9 Z\"/><path d=\"M 7.1 14.9 L 16.9 14.9 Q 18.1 14.9 18.1 16 L 18.1 16 Q 18.1 17.1 16.9 17.1 L 7.1 17.1 Q 5.9 17.1 5.9 16 L 5.9 16 Q 5.9 14.9 7.1 14.9 Z\"/></g>",
  "PlayCircleIcon": "<path d=\"M 9.3247 6.2246 L 17.7753 11.3754 Q 18.8 12 17.7753 12.6246 L 9.3247 17.7754 Q 8.3 18.4 8.3 17.2 L 8.3 6.8 Q 8.3 5.6 9.3247 6.2246 Z\"/>",
  "PauseCircleIcon": "<g transform=\"rotate(90 12 12)\"><path d=\"M 7.1 6.9 L 16.9 6.9 Q 18.1 6.9 18.1 8 L 18.1 8 Q 18.1 9.1 16.9 9.1 L 7.1 9.1 Q 5.9 9.1 5.9 8 L 5.9 8 Q 5.9 6.9 7.1 6.9 Z\"/><path d=\"M 7.1 14.9 L 16.9 14.9 Q 18.1 14.9 18.1 16 L 18.1 16 Q 18.1 17.1 16.9 17.1 L 7.1 17.1 Q 5.9 17.1 5.9 16 L 5.9 16 Q 5.9 14.9 7.1 14.9 Z\"/></g>"
};
function glyph(name: string) {
  return function FlClashIcon(props: SVGProps<SVGSVGElement>) {
    return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-icon-source="flclash" {...props} dangerouslySetInnerHTML={{ __html: paths[name] }} />;
  };
}
export const ArrowDownTrayIcon = glyph("ArrowDownTrayIcon");
export const ArchiveBoxIcon = glyph("ArchiveBoxIcon");
export const ArrowLeftIcon = glyph("ArrowLeftIcon");
export const ArrowPathIcon = glyph("ArrowPathIcon");
export const ArrowUpRightIcon = glyph("ArrowUpRightIcon");
export const BoltIcon = glyph("BoltIcon");
export const BookOpenIcon = glyph("BookOpenIcon");
export const CameraIcon = glyph("CameraIcon");
export const ChartBarIcon = glyph("ChartBarIcon");
export const CheckCircleIcon = glyph("CheckCircleIcon");
export const ChevronDownIcon = glyph("ChevronDownIcon");
export const ChevronLeftIcon = glyph("ChevronLeftIcon");
export const ChevronRightIcon = glyph("ChevronRightIcon");
export const ChevronUpIcon = glyph("ChevronUpIcon");
export const CircleStackIcon = glyph("CircleStackIcon");
export const ClockIcon = glyph("ClockIcon");
export const CpuChipIcon = glyph("CpuChipIcon");
export const ExclamationTriangleIcon = glyph("ExclamationTriangleIcon");
export const LockClosedIcon = glyph("LockClosedIcon");
export const LockOpenIcon = glyph("LockOpenIcon");
export const MagnifyingGlassIcon = glyph("MagnifyingGlassIcon");
export const MapIcon = glyph("MapIcon");
export const MapPinIcon = glyph("MapPinIcon");
export const PhotoIcon = glyph("PhotoIcon");
export const RadioIcon = glyph("RadioIcon");
export const ShieldCheckIcon = glyph("ShieldCheckIcon");
export const TrashIcon = glyph("TrashIcon");
export const VideoCameraIcon = glyph("VideoCameraIcon");
export const WifiIcon = glyph("WifiIcon");
export const WrenchScrewdriverIcon = glyph("WrenchScrewdriverIcon");
export const XMarkIcon = glyph("XMarkIcon");
export const DashboardIcon = glyph("DashboardIcon");
export const ArrowRightIcon = glyph("ArrowRightIcon");
export const PlayIcon = glyph("PlayIcon");
export const PauseIcon = glyph("PauseIcon");
export const PlayCircleIcon = glyph("PlayCircleIcon");
export const PauseCircleIcon = glyph("PauseCircleIcon");

// Vehicle-specific symbols not defined by the reference icon set.
export { ArrowsPointingOutIcon, Battery50Icon, HandRaisedIcon, StopIcon, StopCircleIcon } from "@heroicons/react/24/outline";
