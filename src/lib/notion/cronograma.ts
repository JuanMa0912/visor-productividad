import { getNotionClient, normalizeNotionId } from "./client";

export type NotionPerson = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
};

export type NotionDateValue = {
  start: string | null;
  end: string | null;
};

export type NotionPropertyValue =
  | { type: "title"; value: string }
  | { type: "rich_text"; value: string }
  | { type: "number"; value: number | null }
  | { type: "select"; value: string | null; color: string | null }
  | { type: "multi_select"; value: Array<{ name: string; color: string | null }> }
  | { type: "status"; value: string | null; color: string | null }
  | { type: "date"; value: NotionDateValue | null }
  | { type: "people"; value: NotionPerson[] }
  | { type: "checkbox"; value: boolean }
  | { type: "url"; value: string | null }
  | { type: "email"; value: string | null }
  | { type: "phone_number"; value: string | null }
  | { type: "created_time"; value: string }
  | { type: "last_edited_time"; value: string }
  | { type: "files"; value: Array<{ name: string; url: string | null }> }
  | { type: "relation"; value: string[] }
  | { type: "unknown"; value: null };

export type CronogramaTask = {
  id: string;
  title: string;
  url: string;
  createdTime: string;
  lastEditedTime: string;
  status: { name: string | null; color: string | null };
  assignees: NotionPerson[];
  date: NotionDateValue | null;
  tags: Array<{ name: string; color: string | null }>;
  properties: Record<string, NotionPropertyValue>;
};

export type CronogramaDatabase = {
  id: string;
  title: string;
  url: string;
  statusOptions: Array<{ name: string; color: string | null }>;
  tasks: CronogramaTask[];
};

export type CronogramaPayload = {
  page: { id: string; title: string; url: string };
  databases: CronogramaDatabase[];
  fetchedAt: string;
};

const extractRichText = (
  rt: Array<{ plain_text?: string }> | undefined,
): string => (rt ?? []).map((node) => node?.plain_text ?? "").join("");

const toPerson = (raw: unknown): NotionPerson => {
  const person = raw as {
    id?: string;
    name?: string | null;
    avatar_url?: string | null;
  };
  return {
    id: person?.id ?? "",
    name: person?.name ?? null,
    avatarUrl: person?.avatar_url ?? null,
  };
};

const normalizeProperty = (raw: unknown): NotionPropertyValue => {
  const prop = raw as { type?: string } & Record<string, unknown>;
  const type = prop?.type;
  switch (type) {
    case "title":
      return {
        type: "title",
        value: extractRichText(prop.title as Array<{ plain_text?: string }>),
      };
    case "rich_text":
      return {
        type: "rich_text",
        value: extractRichText(prop.rich_text as Array<{ plain_text?: string }>),
      };
    case "number":
      return { type: "number", value: (prop.number as number | null) ?? null };
    case "select": {
      const sel = prop.select as { name?: string; color?: string } | null;
      return {
        type: "select",
        value: sel?.name ?? null,
        color: sel?.color ?? null,
      };
    }
    case "multi_select": {
      const items = (prop.multi_select as Array<{ name: string; color?: string }>) ?? [];
      return {
        type: "multi_select",
        value: items.map((item) => ({
          name: item.name,
          color: item.color ?? null,
        })),
      };
    }
    case "status": {
      const status = prop.status as { name?: string; color?: string } | null;
      return {
        type: "status",
        value: status?.name ?? null,
        color: status?.color ?? null,
      };
    }
    case "date": {
      const date = prop.date as { start?: string; end?: string | null } | null;
      return {
        type: "date",
        value: date
          ? { start: date.start ?? null, end: date.end ?? null }
          : null,
      };
    }
    case "people": {
      const people = (prop.people as unknown[]) ?? [];
      return { type: "people", value: people.map(toPerson) };
    }
    case "checkbox":
      return { type: "checkbox", value: Boolean(prop.checkbox) };
    case "url":
      return { type: "url", value: (prop.url as string | null) ?? null };
    case "email":
      return { type: "email", value: (prop.email as string | null) ?? null };
    case "phone_number":
      return {
        type: "phone_number",
        value: (prop.phone_number as string | null) ?? null,
      };
    case "created_time":
      return {
        type: "created_time",
        value: (prop.created_time as string) ?? "",
      };
    case "last_edited_time":
      return {
        type: "last_edited_time",
        value: (prop.last_edited_time as string) ?? "",
      };
    case "files": {
      const files = (prop.files as Array<{
        name?: string;
        external?: { url?: string };
        file?: { url?: string };
      }>) ?? [];
      return {
        type: "files",
        value: files.map((file) => ({
          name: file.name ?? "",
          url: file.external?.url ?? file.file?.url ?? null,
        })),
      };
    }
    case "relation": {
      const relations = (prop.relation as Array<{ id: string }>) ?? [];
      return { type: "relation", value: relations.map((rel) => rel.id) };
    }
    default:
      return { type: "unknown", value: null };
  }
};

const findTitleFromProperties = (
  properties: Record<string, NotionPropertyValue>,
): string => {
  for (const value of Object.values(properties)) {
    if (value.type === "title") return value.value || "Sin título";
  }
  return "Sin título";
};

const findStatusFromProperties = (
  properties: Record<string, NotionPropertyValue>,
): { name: string | null; color: string | null } => {
  for (const value of Object.values(properties)) {
    if (value.type === "status") {
      return { name: value.value, color: value.color };
    }
  }
  for (const value of Object.values(properties)) {
    if (value.type === "select") {
      return { name: value.value, color: value.color };
    }
  }
  return { name: null, color: null };
};

const findAssigneesFromProperties = (
  properties: Record<string, NotionPropertyValue>,
): NotionPerson[] => {
  for (const value of Object.values(properties)) {
    if (value.type === "people") return value.value;
  }
  return [];
};

const findDateFromProperties = (
  properties: Record<string, NotionPropertyValue>,
): NotionDateValue | null => {
  for (const value of Object.values(properties)) {
    if (value.type === "date") return value.value;
  }
  return null;
};

const findTagsFromProperties = (
  properties: Record<string, NotionPropertyValue>,
): Array<{ name: string; color: string | null }> => {
  const tags: Array<{ name: string; color: string | null }> = [];
  for (const value of Object.values(properties)) {
    if (value.type === "multi_select") {
      tags.push(...value.value);
    }
  }
  return tags;
};

const fetchChildDatabaseIds = async (pageId: string): Promise<string[]> => {
  const notion = getNotionClient();
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const block of response.results) {
      if ((block as { type?: string }).type === "child_database") {
        ids.push((block as { id: string }).id);
      }
    }
    cursor = response.next_cursor ?? undefined;
  } while (cursor);
  return ids;
};

const queryAllDataSourcePages = async (dataSourceId: string) => {
  const notion = getNotionClient();
  const pages: unknown[] = [];
  let cursor: string | undefined;
  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: cursor,
      page_size: 100,
    });
    pages.push(...response.results);
    cursor = response.next_cursor ?? undefined;
  } while (cursor);
  return pages;
};

const extractStatusOptionsFromSchema = (
  schema: Record<string, unknown> | undefined,
): Array<{ name: string; color: string | null }> => {
  if (!schema) return [];
  let fallbackSelectOptions: Array<{ name: string; color: string | null }> = [];
  for (const propDef of Object.values(schema)) {
    const def = propDef as {
      type?: string;
      status?: { options?: Array<{ name: string; color?: string }> };
      select?: { options?: Array<{ name: string; color?: string }> };
    };
    if (def.type === "status" && def.status?.options) {
      return def.status.options.map((opt) => ({
        name: opt.name,
        color: opt.color ?? null,
      }));
    }
    if (
      def.type === "select" &&
      def.select?.options &&
      fallbackSelectOptions.length === 0
    ) {
      fallbackSelectOptions = def.select.options.map((opt) => ({
        name: opt.name,
        color: opt.color ?? null,
      }));
    }
  }
  return fallbackSelectOptions;
};

const buildTasksFromPages = (pages: unknown[]): CronogramaTask[] =>
  pages.map((rawPage) => {
    const page = rawPage as {
      id: string;
      url?: string;
      created_time?: string;
      last_edited_time?: string;
      properties?: Record<string, unknown>;
    };
    const properties: Record<string, NotionPropertyValue> = {};
    for (const [key, value] of Object.entries(page.properties ?? {})) {
      properties[key] = normalizeProperty(value);
    }
    return {
      id: page.id,
      title: findTitleFromProperties(properties),
      url: page.url ?? "",
      createdTime: page.created_time ?? "",
      lastEditedTime: page.last_edited_time ?? "",
      status: findStatusFromProperties(properties),
      assignees: findAssigneesFromProperties(properties),
      date: findDateFromProperties(properties),
      tags: findTagsFromProperties(properties),
      properties,
    };
  });

const fetchDatabase = async (
  databaseId: string,
): Promise<CronogramaDatabase> => {
  const notion = getNotionClient();
  const meta = await notion.databases.retrieve({ database_id: databaseId });

  const metaTitle = extractRichText(
    (meta as { title?: Array<{ plain_text?: string }> }).title,
  );
  const url = (meta as { url?: string }).url ?? "";
  const dataSourceRefs =
    (meta as { data_sources?: Array<{ id: string; name?: string }> })
      .data_sources ?? [];

  if (dataSourceRefs.length === 0) {
    return {
      id: databaseId,
      title: metaTitle || "Sin título",
      url,
      statusOptions: [],
      tasks: [],
    };
  }

  const dataSources = await Promise.all(
    dataSourceRefs.map(async (ref) => {
      const [schema, pages] = await Promise.all([
        notion.dataSources.retrieve({ data_source_id: ref.id }),
        queryAllDataSourcePages(ref.id),
      ]);
      const statusOptions = extractStatusOptionsFromSchema(
        (schema as { properties?: Record<string, unknown> }).properties,
      );
      const tasks = buildTasksFromPages(pages);
      return { statusOptions, tasks };
    }),
  );

  const combinedStatusOptions: Array<{ name: string; color: string | null }> = [];
  const seenStatuses = new Set<string>();
  for (const ds of dataSources) {
    for (const opt of ds.statusOptions) {
      if (seenStatuses.has(opt.name)) continue;
      seenStatuses.add(opt.name);
      combinedStatusOptions.push(opt);
    }
  }
  const allTasks = dataSources.flatMap((ds) => ds.tasks);

  return {
    id: databaseId,
    title: metaTitle || "Sin título",
    url,
    statusOptions: combinedStatusOptions,
    tasks: allTasks,
  };
};

export const fetchCronograma = async (
  pageIdRaw: string,
): Promise<CronogramaPayload> => {
  const notion = getNotionClient();
  const pageId = normalizeNotionId(pageIdRaw);

  const [pageMeta, databaseIds] = await Promise.all([
    notion.pages.retrieve({ page_id: pageId }),
    fetchChildDatabaseIds(pageId),
  ]);

  const databases = await Promise.all(databaseIds.map(fetchDatabase));

  const pageTitle = (() => {
    const properties = (pageMeta as { properties?: Record<string, unknown> })
      .properties;
    if (!properties) return "Cronograma";
    for (const value of Object.values(properties)) {
      const prop = value as { type?: string; title?: Array<{ plain_text?: string }> };
      if (prop.type === "title") {
        return extractRichText(prop.title) || "Cronograma";
      }
    }
    return "Cronograma";
  })();

  return {
    page: {
      id: pageId,
      title: pageTitle,
      url: (pageMeta as { url?: string }).url ?? "",
    },
    databases,
    fetchedAt: new Date().toISOString(),
  };
};
