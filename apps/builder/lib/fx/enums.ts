/**
 * Named values formulas can use, as in Power Fx: Color.Red, ScreenTransition.Fade,
 * NotificationType.Error, FormMode.New and so on. Colors are CSS colors.
 */
import type { Rec } from "./values";

const names = (...list: string[]): Rec => Object.fromEntries(list.map((n) => [n, n]));

export const COLORS: Record<string, string> = {
  Black: "#000000", White: "#FFFFFF", Transparent: "rgba(0,0,0,0)",
  Red: "#FF0000", DarkRed: "#8B0000", Crimson: "#DC143C", Pink: "#FFC0CB", HotPink: "#FF69B4",
  Orange: "#FFA500", DarkOrange: "#FF8C00", Coral: "#FF7F50", Tomato: "#FF6347",
  Yellow: "#FFFF00", Gold: "#FFD700", Khaki: "#F0E68C",
  Green: "#008000", DarkGreen: "#006400", LimeGreen: "#32CD32", SeaGreen: "#2E8B57", Teal: "#008080",
  Blue: "#0000FF", Navy: "#000080", DarkBlue: "#00008B", RoyalBlue: "#4169E1", DodgerBlue: "#1E90FF", SkyBlue: "#87CEEB", LightBlue: "#ADD8E6", SteelBlue: "#4682B4",
  Purple: "#800080", Indigo: "#4B0082", Violet: "#EE82EE", Lavender: "#E6E6FA",
  Brown: "#A52A2A", Tan: "#D2B48C", Beige: "#F5F5DC",
  Gray: "#808080", DarkGray: "#A9A9A9", LightGray: "#D3D3D3", Silver: "#C0C0C0", DimGray: "#696969", WhiteSmoke: "#F5F5F5", Gainsboro: "#DCDCDC",
};

export const ENUMS: Record<string, Rec> = {
  Color: { ...COLORS },
  ScreenTransition: names("None", "Fade", "Cover", "CoverRight", "UnCover", "UnCoverRight"),
  NotificationType: names("Success", "Error", "Warning", "Information"),
  DisplayMode: names("Edit", "Disabled", "View"),
  FormMode: names("Edit", "New", "View"),
  SortOrder: names("Ascending", "Descending"),
  TimeUnit: names("Milliseconds", "Seconds", "Minutes", "Hours", "Days", "Weeks", "Months", "Quarters", "Years"),
  Align: names("Left", "Center", "Right", "Justify"),
  VerticalAlign: names("Top", "Middle", "Bottom"),
  FontWeight: names("Normal", "Lighter", "Semibold", "Bold"),
  TextMode: names("SingleLine", "MultiLine", "Password"),
  ImagePosition: names("Fit", "Fill", "Stretch", "Center"),
  DateTimeFormat: names("ShortDate", "LongDate", "ShortTime", "LongTime", "ShortDateTime", "LongDateTime", "UTC"),
  Layout: names("Vertical", "Horizontal"),
};
