export type CalendarEvent = {
  weekday: number; // 1=Mon .. 7=Sun
  periods: number[];
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  title: string;
  teacher: string;
  className: string;
  classroom?: string;
};

export interface AbsenceRecord {
  index: number;
  className: string;
  courseName: string;
  isYearCourse: boolean;
  group: string;
  type: string;
  creditHours: string;
  teacher: string;
  absence: string;
  absenceDetail: string[];
  semester: string;
}


export type AnnouncementListItem = {
  bid: number;
  index: number;
  publisher: string;
  category: string;
  title: string;

  sourcePage: number;
};

export type AnnouncementListResponse = {
  items: AnnouncementListItem[];
  currentPage: number;
  totalPages: number;
};

