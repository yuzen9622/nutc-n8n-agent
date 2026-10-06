// Adapted from nutc_student_system b2e4d4f: list and page parsing only.
import * as cheerio from "cheerio";
import type {AnnouncementListItem} from "./school.type.js";
function toPositiveInt(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function parseLastPageNumber(html: string): number {
  const $ = cheerio.load(html);
  let maxPage = 1;

  $(".page a[href*='_p=']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const match = href.match(/[?&]_p=(\d+)/);
    if (!match) {
      return;
    }

    const pageRaw = match[1];
    if (!pageRaw) {
      return;
    }

    const page = toPositiveInt(pageRaw);
    if (page && page<=10000 && page > maxPage) {
      maxPage = page;
    }
  });

  if (maxPage > 1) {
    return maxPage;
  }

  for (const match of html.matchAll(/[?&]_p=(\d+)/g)) {
    const pageRaw = match[1];
    if (!pageRaw) {
      continue;
    }

    const page = toPositiveInt(pageRaw);
    if (page && page<=10000 && page > maxPage) {
      maxPage = page;
    }
  }

  return maxPage;
}

export function parseAnnouncementList(
  html: string,
  sourcePage: number,
): AnnouncementListItem[] {
  const $ = cheerio.load(html);
  const result: AnnouncementListItem[] = [];

  $("table.grid_view tr")
    .slice(1)
    .each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length < 5) {
        return;
      }

      const index = toPositiveInt($(cells[0]).text().trim());
      const publisher = normalizeText($(cells[1]).text());
      const category = normalizeText($(cells[2]).text());
      const title = normalizeText($(cells[3]).text());

      // Some table layouts include a date column at [4]; action shifts to [5]
      const hasDateColumn = cells.length >= 6;
      const publishedAt = hasDateColumn
        ? normalizeText($(cells[4]).text()) || null
        : null;
      const actionCell = cells[hasDateColumn ? 5 : 4];

      const actionEl = $(actionCell).find("[onclick]").first();
      const onclick = actionEl.attr("onclick") ?? "";
      const bidMatch = onclick.match(/view\((\d+)\)/);
      if (!bidMatch) {
        return;
      }

      const bidRaw = bidMatch[1];
      if (!bidRaw) {
        return;
      }

      const bid = toPositiveInt(bidRaw);
      if (!bid) {
        return;
      }

      result.push({
        bid,
        index: index ?? result.length + 1,
        publisher,
        category,
        title,

        sourcePage,
      });
    });

  return result.sort((a, b) => b.bid - a.bid);
}

