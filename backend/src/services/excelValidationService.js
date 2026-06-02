const XLSX = require('xlsx');

const REQUIRED_COLUMNS = [
  'Company Name',
  'Email',
];

const ALLOWED_COLUMNS = [
  'Company Name',
  'Lead Type',
  'Contact Name',
  'Job Title',
  'Email',
  'Phone',
  'Lead Status',
  'Lead Source',
  'Score',
  'Follow-up Date',
  'Assign Lead To',
  'Website',
  'Industry',
  'Location',
  'Description / Notes',
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

  // All required columns must be present in the file
  for (const col of REQUIRED_COLUMNS) {
    if (!headers.includes(col)) {
      headerErrors.push(`Missing required column: "${col}"`);
    }
  }

  // Reject any column not in the allowed list
  for (const header of headers) {
    if (!ALLOWED_COLUMNS.includes(header)) {
      headerErrors.push(`Invalid column found: "${header}"`);
    }
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

    // All required columns must have a non-empty value in every data row
    const emptyColumns = REQUIRED_COLUMNS.filter(
      col => String(record[col] ?? '').trim() === ''
    );

    if (emptyColumns.length > 0) {
      rowErrors.push(
        `Row ${rowNum}: missing required value(s) for: ${emptyColumns.map(c => `"${c}"`).join(', ')}`
      );
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
