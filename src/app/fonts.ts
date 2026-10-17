import localFont from "next/font/local";

/**
 * Readex Pro (OFL) — خط واحد للعربية والفرنسية والإنجليزية، مستضاف ذاتيًا.
 * ملف متغيّر (variable) يغطي الأوزان 400/500/600/700، مقسّم إلى ثلاث مجموعات
 * بـ unicode-range كي لا يُحمَّل إلا ما تحتاجه الصفحة.
 */
// ملاحظة: next/font يتطلب وسائط حرفية (literal) عند كل استدعاء، لذا لا نغلّفها بدالة.
export const readexArabic = localFont({
  src: [{ path: "./fonts/readex-pro-arabic-wght-normal.woff2", weight: "400 700", style: "normal" }],
  variable: "--f-ar",
  display: "swap",
  preload: true,
  declarations: [{ prop: "unicode-range", value: "U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC" }],
  fallback: ["Tahoma", "system-ui", "sans-serif"],
});
export const readexLatin = localFont({
  src: [{ path: "./fonts/readex-pro-latin-wght-normal.woff2", weight: "400 700", style: "normal" }],
  variable: "--f-lat",
  display: "swap",
  preload: true,
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
  fallback: ["Tahoma", "system-ui", "sans-serif"],
});
export const readexLatinExt = localFont({
  src: [{ path: "./fonts/readex-pro-latin-ext-wght-normal.woff2", weight: "400 700", style: "normal" }],
  variable: "--f-lat-ext",
  display: "swap",
  preload: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" }],
  fallback: ["Tahoma", "system-ui", "sans-serif"],
});

export const fontClasses = `${readexArabic.variable} ${readexLatin.variable} ${readexLatinExt.variable}`;
