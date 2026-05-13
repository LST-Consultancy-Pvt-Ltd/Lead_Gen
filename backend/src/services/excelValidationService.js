const XLSX = require('xlsx');

const ALLOWED_COLUMNS = [
  'Company',
  'Contact',
  'Assign To',
  'Score',
  'Status',
  'Product / Position',
  'Source URL',
  'Next Follow-up',
];

async function validateExcelFile(buffer) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    return { valid: false, errors: ['Excel file is empty'] };
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { valid: false, errors: ['Excel file is empty'] };
  }

  const sheet = workbook.Sheets[sheetName];
  const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  if (!allRows || allRows.length === 0) {
    return { valid: false, errors: ['Excel file is empty'] };
  }

  // First element is the header row
  const headerRow = allRows[0];
  if (!Array.isArray(headerRow) || headerRow.length === 0) {
    return { valid: false, errors: ['Excel file is empty'] };
  }

  const headers = headerRow
    .map(h => String(h ?? '').trim())
    .filter(h => h !== '');

  if (headers.length === 0) {
    return { valid: false, errors: ['Excel file is empty'] };
  }

  // Build header -> column index map for fast lookup
  const headerIndexMap = {};
  headerRow.forEach((h, idx) => {
    const trimmed = String(h ?? '').trim();
    if (trimmed) headerIndexMap[trimmed] = idx;
  });

  const headerErrors = [];

  // Reject any column not in the allowed list
  for (const header of headers) {
    if (!ALLOWED_COLUMNS.includes(header)) {
      headerErrors.push(`Invalid column found: ${header}`);
    }
  }

  // Company column must be present
  if (!headers.includes('Company')) {
    headerErrors.push('Company column is required');
  }

  if (headerErrors.length > 0) {
    return { valid: false, errors: headerErrors };
  }

  const rowErrors = [];
  const records = [];

  for (let i = 1; i < allRows.length; i++) {
    const rowData = allRows[i];
    const rowNum = i + 1; // 1-indexed, header is row 1

    // Silently skip completely blank rows
    const hasData =
      Array.isArray(rowData) &&
      rowData.some(
        cell => cell !== undefined && cell !== null && String(cell).trim() !== ''
      );
    if (!hasData) continue;

    // Build a plain object keyed by column header
    const record = {};
    for (const header of headers) {
      const colIdx = headerIndexMap[header];
      const value =
        Array.isArray(rowData) && colIdx !== undefined
          ? (rowData[colIdx] ?? '')
          : '';
      record[header] = value;
    }

    // Company value must be non-empty
    const company = String(record['Company'] ?? '').trim();
    if (!company) {
      rowErrors.push(`Company is required at row ${rowNum}`);
      continue;
    }

    records.push(record);
  }

  if (rowErrors.length > 0) {
    return { valid: false, errors: rowErrors };
  }

  return { valid: true, records, headers };
}

module.exports = { validateExcelFile };
