export type MilestonePriority = 1 | 2 | 3;

export type Milestone = {
  id: string;
  name: string;
  date: string;
  priority?: MilestonePriority;
};

export type Entry = {
  id: string;
  name: string;
  start: string;
  end: string;
  row: number;
  parentId?: string;
  parentMark?: { entryId: string; markId: string };
  icon?: string;
  iconColor?: string;
  color?: string;
  milestones: Milestone[];
};

export const seedEntries: Entry[] = [
  {
    id: "foundation",
    name: "Foundation",
    start: "2026-01-12",
    end: "2026-03-28",
    row: 0,
    milestones: [
      { id: "ga", name: "GA", date: "2026-03-18", priority: 3 },
      { id: "kickoff", name: "Kickoff", date: "2026-01-22", priority: 2 },
    ],
  },
  {
    id: "calendar",
    name: "Calendar view",
    start: "2026-03-18",
    end: "2026-07-10",
    row: 1,
    milestones: [
      { id: "ship", name: "Ship", date: "2026-07-02", priority: 3 },
      { id: "beta", name: "Beta", date: "2026-05-12" },
    ],
  },
  {
    id: "connections",
    name: "Milestone links",
    start: "2026-05-12",
    end: "2026-09-18",
    row: 2,
    milestones: [{ id: "review", name: "Review", date: "2026-08-20" }],
  },
];
