import type { IconName } from "../model/types";

// Shared by the on-screen icons and the PNG export.
export const PATHS: Record<IconName, string[]> = {
  hand: ["M9 11V5.5a1.5 1.5 0 0 1 3 0V10m0-1.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.2a6 6 0 0 1-4.7-2.3L4 15.5a1.6 1.6 0 0 1 2.4-2L9 16"],
  shield: ["M12 3 4.5 6v5.5c0 4.5 3.2 8.1 7.5 9.5 4.3-1.4 7.5-5 7.5-9.5V6L12 3Z", "m9 12 2 2 4-4"],
  check: ["M5 12.5 10 17.5 19 7"],
  dice: ["M5 5h14v14H5z", "M9 9h.01M15 9h.01M9 15h.01M15 15h.01M12 12h.01"],
  hash: ["M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"],
  filter: ["M4 5h16l-6 8v6l-4-2v-4L4 5Z"],
  db: ["M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Z", "M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6", "M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"],
  trash: ["M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"],
  reply: ["M10 8 4 13l6 5", "M4 13h10a6 6 0 0 0 6-6V5"],
  search: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z", "m20 20-4-4"],
  bolt: ["M13 3 5 13h6l-1 8 8-10h-6l1-8Z"],
  plus: ["M12 5v14M5 12h14"],
  click: ["M9 4v3M4 9h3M5.5 5.5 7.6 7.6M12 12l8 3-3.5 1.5L15 20l-3-8Z"],
  clock: ["M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z", "M12 8v4l3 2"],
  link: ["M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1", "M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"],
};
