/** الصفحة الأم: نحذف آخر مقطع من المسار (والرئيسية للمستوى الأول) */
export function parentPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? "/" + parts.join("/") : "/";
}
