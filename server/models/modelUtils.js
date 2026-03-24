const nowIso = () => new Date().toISOString();

const readRowValue = (row, key) => {
  if (!row) {
    return undefined;
  }

  if (row[key] !== undefined) {
    return row[key];
  }

  const normalizedKey = key.toLowerCase();

  if (row[normalizedKey] !== undefined) {
    return row[normalizedKey];
  }

  return undefined;
};

const buildWhereClause = (criteria = {}) => {
  const entries = Object.entries(criteria).filter(([, value]) => value !== undefined);

  if (!entries.length) {
    return { clause: "", values: [] };
  }

  const clause = `WHERE ${entries.map(([field]) => `${field} = ?`).join(" AND ")}`;
  const values = entries.map(([, value]) => (typeof value === "boolean" ? Number(value) : value));

  return { clause, values };
};

const buildOrderByClause = (sort = {}) => {
  const entries = Object.entries(sort);

  if (!entries.length) {
    return "";
  }

  return `ORDER BY ${entries
    .map(([field, direction]) => `${field} ${direction === -1 ? "DESC" : "ASC"}`)
    .join(", ")}`;
};

module.exports = {
  buildOrderByClause,
  buildWhereClause,
  nowIso,
  readRowValue,
};
