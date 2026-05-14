const XLSX = require('xlsx');

function generateTemplate() {
  const headers = [
    'Company',
    'Contact',
    'Assign To',
    'Score',
    'Status',
    'Product / Position',
    'Source URL',
    'Next Follow-up',
  ];

  const sampleRow = [
    'ABC Pvt Ltd',
    'John Doe',
    'Admin',
    '90',
    'New',
    'Software Engineer',
    'https://example.com',
    '2026-01-10',
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { generateTemplate };
