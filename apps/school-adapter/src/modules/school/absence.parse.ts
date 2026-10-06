// Adapted from nutc_student_system b2e4d4f: read-only absence.parse.ts.
import * as cheerio from "cheerio";
import type { AbsenceRecord } from "./school.type.js";

export function parseAbsences(html: string): AbsenceRecord[] {
  const $ = cheerio.load(html);
  const result: AbsenceRecord[] = [];

  $("tr.tr_data").each((_, el) => {
    const tds = $(el).find("td");
    if(tds.length<8)return;

    const courseNameRaw = $(tds[2]).text().trim();
    const isYearCourse = courseNameRaw.includes("(學年課)");

    // 清掉 "(學年課)"
    const courseName = courseNameRaw.replace("(學年課)", "").trim();

    const absenceText = $(tds[7]).text().trim();

    // 解析詳細缺曠 (從 oldtitle 拿)
    const rawDetail = $(tds[7]).attr("oldtitle") || "";
    const absenceDetail = rawDetail
      .split("</br>")
      .map((s) => s.trim())
      .filter(Boolean);

    result.push({
      index: Number($(tds[0]).text().trim()),
      className: $(tds[1]).text().trim(),
      courseName,
      isYearCourse,
      group: $(tds[3]).text().trim(),
      type: $(tds[4]).text().trim(),
      creditHours: $(tds[5]).text().trim(),
      teacher: $(tds[6]).text().trim(),
      absence: absenceText,
      absenceDetail,
      semester: $(el).attr("data-yysem") || "",
    });
  });

  return result;
}

