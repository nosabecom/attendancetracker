import Papa from "papaparse";
export const normalize = (value) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
export function parseRoster(csv) {
  const result = Papa.parse(csv.replace(/^\uFEFF/, ""), {
    skipEmptyLines: "greedy",
    delimiter: ",",
  });
  if (result.errors.length)
    throw new Error(
      "The CSV could not be read. Check quotation marks and column counts.",
    );
  const rows = result.data;
  if (!rows.length) throw new Error("This CSV is empty.");
  const headers = rows[0].map((v) => normalize(v).replace(/[ _-]/g, ""));
  const nameCol = headers.findIndex((h) =>
    ["name", "fullname", "studentname"].includes(h),
  );
  const firstCol = headers.indexOf("firstname"),
    lastCol = headers.indexOf("lastname");
  const idCol = headers.findIndex((h) =>
    ["id", "studentid", "studentnumber", "email"].includes(h),
  );
  const hasHeader = nameCol >= 0 || firstCol >= 0;
  const data = hasHeader ? rows.slice(1) : rows;
  if (data.length > 1000)
    throw new Error("Please import up to 1,000 students at a time.");
  const seen = new Set();
  const students = data.map((row, i) => {
    const name = (
      nameCol >= 0
        ? row[nameCol]
        : firstCol >= 0
          ? [row[firstCol], lastCol >= 0 ? row[lastCol] : ""].join(" ")
          : row[0]
    )?.trim();
    const code = hasHeader && idCol >= 0 ? row[idCol]?.trim() : "";
    if (!name || name.length > 160 || (code?.length || 0) > 160)
      throw new Error(
        `Check the name or student ID on row ${i + (hasHeader ? 2 : 1)}.`,
      );
    const identity = normalize(code || name);
    if (seen.has(identity))
      throw new Error(
        `Duplicate student: ${name}. Give students with the same name unique student IDs.`,
      );
    seen.add(identity);
    return { id: String(i + 1), name, code: code || "" };
  });
  if (!students.length)
    throw new Error("Add at least one student below the header.");
  return students;
}
export function matchStudent(students, input) {
  const value = normalize(input);
  const byCode = students.filter((s) => s.code && normalize(s.code) === value);
  if (byCode.length === 1) return byCode[0];
  const byName = students.filter((s) => normalize(s.name) === value);
  return byName.length === 1 ? byName[0] : null;
}
